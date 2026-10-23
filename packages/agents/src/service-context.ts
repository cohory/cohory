import {
  assertCan,
  can,
  UnauthenticatedError,
  type Actor,
  availableScopes,
  ForbiddenError,
  memberAgentScopes,
  type CommunityRole,
  type Scope,
  type ScopeHolder,
} from "@cohory/authz";
import {
  appendAuditEntry,
  getMembership,
  newId as defaultNewId,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { agentIdentities, apiTokens, users, type AgentStatus } from "@cohory/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import { AgentsError, AgentsValidationError, ScopeNotAvailableError } from "./errors";
import { agentManageContext } from "./manage-context";
import type { updateAgentInputSchema } from "./schemas";
import { createAgentInputSchema, maxTokenDays, parseInput, type CreateAgentInput } from "./schemas";
import { generateToken } from "./token";
import { knownScopes, toTokenView, type AgentView, type CreatedToken } from "./views";

const dayMs = 24 * 60 * 60 * 1000;

const memberAgentScopeSet: ReadonlySet<string> = new Set(memberAgentScopes);

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly status: AgentStatus;
}

export const agentSummaryColumns = {
  id: agentIdentities.id,
  name: agentIdentities.name,
  ownerId: agentIdentities.ownerId,
  status: agentIdentities.status,
};

export interface AgentsServiceDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface ApiWrite {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

type AgentRow = typeof agentIdentities.$inferSelect;
type TokenRow = typeof apiTokens.$inferSelect;
type UpdateAgentParsed = z.output<typeof updateAgentInputSchema>;

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUser(actor: Actor): { userId: string } {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  if (actor.credential) {
    throw new ForbiddenError("manage", "api_token");
  }
  return { userId: actor.userId };
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/[^a-z_]/g, "");
}

export function assertAvailable(
  role: CommunityRole | null,
  holder: ScopeHolder,
  requested: readonly Scope[],
): void {
  const available = availableScopes(role, holder);
  const refused = requested.filter((scope) => !available.includes(scope));
  if (refused.length > 0) {
    throw new ScopeNotAvailableError(refused);
  }
}

export function lifetimeDays(token: Pick<TokenRow, "createdAt" | "expiresAt">): number {
  const days = Math.round((token.expiresAt.getTime() - token.createdAt.getTime()) / dayMs);
  return Math.min(Math.max(days, 1), maxTokenDays);
}

export function assertRegenerable(token: Pick<TokenRow, "revokedAt">): void {
  if (token.revokedAt) {
    throw new AgentsValidationError([
      { path: "tokenId", message: "This token was revoked. Create a new one instead." },
    ]);
  }
}

export function apiWriteAction(operationId: string): string {
  return `api.${snakeCase(operationId)}`;
}

export function createAgentsContext(deps: AgentsServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;

  async function roleIn(communityId: string, userId: string): Promise<CommunityRole | null> {
    const membership = await getMembership(
      withCommunity(deps.db, parseCommunityId(communityId)),
      userId,
    );
    return membership?.status === "active" ? membership.role : null;
  }

  function scoped<T>(communityId: string, fn: (queries: ScopedQueries) => Promise<T>) {
    return runInCommunity(withCommunity(deps.db, parseCommunityId(communityId)), fn);
  }

  async function loadAgent(queries: ScopedQueries, agentId: string): Promise<AgentRow> {
    const [agent] = uuidPattern.test(agentId)
      ? await queries.tx
          .select()
          .from(agentIdentities)
          .where(queries.where(agentIdentities, eq(agentIdentities.id, agentId)))
          .limit(1)
      : [];
    if (!agent) {
      throw new AgentsError("not_found");
    }
    return agent;
  }

  function assertPersonalAgent(input: {
    scopes?: readonly string[] | undefined;
    communityWide?: boolean | undefined;
  }): void {
    const issues = [
      ...(input.communityWide
        ? [
            {
              path: "communityWide",
              message: "Only owners and admins create community wide agents.",
            },
          ]
        : []),
      ...(input.scopes && input.scopes.some((scope) => !memberAgentScopeSet.has(scope))
        ? [
            {
              path: "scopes",
              message: "Your agents can read the community and courses and propose purchases only.",
            },
          ]
        : []),
    ];
    if (issues.length > 0) {
      throw new AgentsValidationError(issues);
    }
  }

  function assertManagerChange(agent: AgentRow, input: UpdateAgentParsed): void {
    const current = new Set<string>(agent.scopes);
    const changes = [
      {
        path: "name",
        changed: input.name !== undefined && input.name !== agent.name,
        message: "Only the agent's owner can rename it.",
      },
      {
        path: "description",
        changed: input.description !== undefined && input.description !== agent.description,
        message: "Only the agent's owner can change its description.",
      },
      {
        path: "scopes",
        changed: input.scopes !== undefined && input.scopes.some((scope) => !current.has(scope)),
        message: "Only the agent's owner can add permissions. You can remove them.",
      },
      {
        path: "communityWide",
        changed: input.communityWide !== undefined && input.communityWide !== agent.communityWide,
        message: "Only the agent's owner can change who manages it.",
      },
      {
        path: "status",
        changed: input.status === "active" && agent.status !== "active",
        message: "Only the agent's owner can resume it.",
      },
    ];
    const issues = changes
      .filter((change) => change.changed)
      .map(({ path, message }) => ({ path, message }));
    if (issues.length > 0) {
      throw new AgentsValidationError(issues);
    }
  }

  async function ownerName(queries: ScopedQueries, userId: string): Promise<string | null> {
    const [row] = await queries.tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    return row?.name ?? null;
  }

  async function insertToken(
    queries: ScopedQueries,
    input: {
      kind: "personal" | "agent";
      userId: string;
      agentId: string | null;
      name: string;
      scopes: readonly string[];
      expiresInDays: number;
      createdBy: string;
    },
  ): Promise<CreatedToken> {
    const generated = generateToken();
    const at = now();
    const [row] = await queries.tx
      .insert(apiTokens)
      .values(
        queries.values({
          id: newId(),
          kind: input.kind,
          userId: input.userId,
          agentId: input.agentId,
          name: input.name,
          tokenHash: generated.hash,
          prefix: generated.prefix,
          scopes: [...input.scopes],
          expiresAt: new Date(at.getTime() + input.expiresInDays * dayMs),
          createdBy: input.createdBy,
          createdAt: at,
        }),
      )
      .returning();
    if (!row) {
      throw new Error("token insert returned no row");
    }
    return { token: generated.token, view: toTokenView(row, at) };
  }

  async function audit(
    queries: ScopedQueries,
    actorId: string,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await appendAuditEntry(queries, { actorId, action, target, metadata, at: now() });
  }

  async function agentViews(
    queries: ScopedQueries,
    rows: readonly (AgentRow & { ownerName: string | null })[],
    viewer: { userId: string; role: CommunityRole | null; actor: Actor },
  ): Promise<AgentView[]> {
    const ids = rows.map((row) => row.id);
    const tokens =
      ids.length === 0
        ? []
        : await queries.tx
            .select()
            .from(apiTokens)
            .where(queries.where(apiTokens, inArray(apiTokens.agentId, ids)))
            .orderBy(desc(apiTokens.createdAt));
    const at = now();
    return rows.map((row) => ({
      id: row.id,
      communityId: row.communityId,
      name: row.name,
      description: row.description,
      scopes: knownScopes(row.scopes),
      status: row.status,
      communityWide: row.communityWide,
      owner: { id: row.ownerId, name: row.ownerName ?? "Former member" },
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
      canManage: can(
        viewer.actor,
        "manage",
        "agent",
        agentManageContext(viewer.role, row, viewer.userId),
      ),
      canIssueTokens:
        row.ownerId === viewer.userId &&
        can(viewer.actor, "manage", "agent", agentManageContext(viewer.role, row, viewer.userId)),
      tokens: tokens.filter((token) => token.agentId === row.id).map((t) => toTokenView(t, at)),
    }));
  }

  async function prepareAgent(actor: Actor, communityId: string, input: CreateAgentInput) {
    const { userId } = requireUser(actor);
    const parsed = parseInput(createAgentInputSchema, input);
    const role = await roleIn(communityId, userId);
    const staff = can(actor, "create", "agent", { role });
    if (!staff) {
      assertCan(actor, "create_own", "agent", { role });
      assertPersonalAgent(parsed);
    }
    assertAvailable(role, staff ? "agent" : "personal_agent", parsed.scopes);
    return { userId, parsed, role };
  }

  async function insertAgent(
    queries: ScopedQueries,
    actor: Actor,
    { userId, parsed, role }: Awaited<ReturnType<typeof prepareAgent>>,
  ): Promise<AgentView> {
    const [row] = await queries.tx
      .insert(agentIdentities)
      .values(
        queries.values({
          id: newId(),
          ownerId: userId,
          name: parsed.name,
          description: parsed.description,
          scopes: [...parsed.scopes],
          communityWide: parsed.communityWide,
          createdBy: userId,
          createdAt: now(),
          updatedAt: now(),
        }),
      )
      .returning();
    if (!row) {
      throw new Error("agent insert returned no row");
    }
    await audit(queries, userId, "agent.created", row.id, {
      name: row.name,
      scopes: parsed.scopes,
      communityWide: row.communityWide,
    });
    const [view] = await agentViews(
      queries,
      [{ ...row, ownerName: await ownerName(queries, userId) }],
      { userId, role, actor },
    );
    if (!view) {
      throw new Error("agent view missing");
    }
    return view;
  }

  return {
    deps,
    now,
    newId,
    roleIn,
    scoped,
    loadAgent,
    assertPersonalAgent,
    assertManagerChange,
    ownerName,
    insertToken,
    audit,
    agentViews,
    prepareAgent,
    insertAgent,
  };
}

export type AgentsContext = ReturnType<typeof createAgentsContext>;
