import { assertCan, can, type Actor, type ApiCredential } from "@cohory/authz";
import { auditEntriesWritten, getDb } from "@cohory/db";
import { agentIdentities, apiTokens, users } from "@cohory/db/schema";
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { createAgentTokenMethods } from "./agent-tokens";
import { authenticateToken, type AuthenticatedToken, type TokenChannel } from "./authenticate";
import { revokeAllCredentials, type RevokedCredentials } from "./credentials";
import { AgentsError } from "./errors";
import { agentManageContext } from "./manage-context";
import {
  issueAgentTokenInputSchema,
  parseInput,
  updateAgentInputSchema,
  type CreateAgentInput,
  type IssueAgentTokenInput,
  type UpdateAgentInput,
} from "./schemas";
import { createPersonalTokenMethods } from "./personal-tokens";
import {
  agentSummaryColumns,
  apiWriteAction,
  assertAvailable,
  createAgentsContext,
  requireUser,
  uuidPattern,
  type AgentSummary,
  type AgentsServiceDeps,
  type ApiWrite,
} from "./service-context";
import type { AgentView, CreatedToken } from "./views";

export { memberAgentScopes } from "@cohory/authz";
export {
  apiWriteAction,
  type AgentSummary,
  type AgentsServiceDeps,
  type ApiWrite,
} from "./service-context";

export function createAgentsService(deps: AgentsServiceDeps) {
  const ctx = createAgentsContext(deps);
  const {
    now,
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
  } = ctx;

  return {
    ...createPersonalTokenMethods(ctx),
    ...createAgentTokenMethods(ctx),

    authenticate(raw: string, channel: TokenChannel = "api"): Promise<AuthenticatedToken> {
      return authenticateToken(deps.db, raw, now(), channel);
    },

    async listAgents(actor: Actor, communityId: string): Promise<AgentView[]> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "read", "agent", { role });
      return scoped(communityId, async (queries) => {
        const rows = await queries.tx
          .select({ agent: agentIdentities, ownerName: users.name })
          .from(agentIdentities)
          .leftJoin(users, eq(users.id, agentIdentities.ownerId))
          .where(queries.where(agentIdentities))
          .orderBy(asc(agentIdentities.status), desc(agentIdentities.createdAt));
        return agentViews(
          queries,
          rows.map((row) => ({ ...row.agent, ownerName: row.ownerName })),
          { userId, role, actor },
        );
      });
    },

    async listOwnAgents(actor: Actor, communityId: string): Promise<AgentView[]> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "create_own", "agent", { role });
      return scoped(communityId, async (queries) => {
        const rows = await queries.tx
          .select()
          .from(agentIdentities)
          .where(queries.where(agentIdentities, eq(agentIdentities.ownerId, userId)))
          .orderBy(asc(agentIdentities.status), desc(agentIdentities.createdAt));
        const name = await ownerName(queries, userId);
        return agentViews(
          queries,
          rows.map((row) => ({ ...row, ownerName: name })),
          { userId, role, actor },
        );
      });
    },

    async findAgent(communityId: string, agentId: string): Promise<AgentSummary | null> {
      if (!uuidPattern.test(agentId)) {
        return null;
      }
      return scoped(communityId, async (queries) => {
        const [row] = await queries.tx
          .select(agentSummaryColumns)
          .from(agentIdentities)
          .where(queries.where(agentIdentities, eq(agentIdentities.id, agentId)))
          .limit(1);
        return row ?? null;
      });
    },

    async agentSummaries(
      communityId: string,
      filter: { readonly ownerId?: string; readonly agentIds?: readonly string[] },
    ): Promise<AgentSummary[]> {
      const ids = filter.agentIds?.filter((id) => uuidPattern.test(id));
      if (ids && ids.length === 0) {
        return [];
      }
      return scoped(communityId, (queries) =>
        queries.tx
          .select(agentSummaryColumns)
          .from(agentIdentities)
          .where(
            queries.where(
              agentIdentities,
              filter.ownerId ? eq(agentIdentities.ownerId, filter.ownerId) : undefined,
              ids ? inArray(agentIdentities.id, ids) : undefined,
            ),
          )
          .orderBy(asc(agentIdentities.status), asc(agentIdentities.name)),
      );
    },

    async createAgent(actor: Actor, communityId: string, input: CreateAgentInput) {
      const prepared = await prepareAgent(actor, communityId, input);
      return scoped(communityId, (queries) => insertAgent(queries, actor, prepared));
    },

    async createAgentWithToken(
      actor: Actor,
      communityId: string,
      input: CreateAgentInput & { readonly token: IssueAgentTokenInput },
    ): Promise<{ agent: AgentView; token: CreatedToken }> {
      const { token: tokenInput, ...agentInput } = input;
      const prepared = await prepareAgent(actor, communityId, agentInput);
      const tokenParsed = parseInput(issueAgentTokenInputSchema, tokenInput);
      return scoped(communityId, async (queries) => {
        const agent = await insertAgent(queries, actor, prepared);
        const token = await insertToken(queries, {
          kind: "agent",
          userId: prepared.userId,
          agentId: agent.id,
          name: tokenParsed.name,
          scopes: agent.scopes,
          expiresInDays: tokenParsed.expiresInDays,
          createdBy: prepared.userId,
        });
        await audit(queries, prepared.userId, "agent.token_created", agent.id, {
          tokenId: token.view.id,
          name: tokenParsed.name,
          expiresAt: token.view.expiresAt.toISOString(),
        });
        return { agent: { ...agent, tokens: [token.view] }, token };
      });
    },

    async updateAgent(
      actor: Actor,
      communityId: string,
      agentId: string,
      input: UpdateAgentInput,
    ): Promise<void> {
      const { userId } = requireUser(actor);
      const parsed = parseInput(updateAgentInputSchema, input);
      const role = await roleIn(communityId, userId);
      await scoped(communityId, async (queries) => {
        const agent = await loadAgent(queries, agentId);
        assertCan(actor, "manage", "agent", agentManageContext(role, agent, userId));
        if (agent.status === "revoked") {
          throw new AgentsError("agent_not_active");
        }
        if (agent.ownerId !== userId) {
          assertManagerChange(agent, parsed);
        }
        const staff = can(actor, "create", "agent", { role });
        if (!staff) {
          assertPersonalAgent(parsed);
        }
        if (parsed.scopes) {
          const current = new Set<string>(agent.scopes);
          assertAvailable(
            role,
            staff ? "agent" : "personal_agent",
            parsed.scopes.filter((scope) => !current.has(scope)),
          );
        }
        const at = now();
        const statusChange =
          parsed.status && parsed.status !== agent.status ? parsed.status : undefined;
        await queries.tx
          .update(agentIdentities)
          .set({
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.description !== undefined ? { description: parsed.description } : {}),
            ...(parsed.scopes !== undefined ? { scopes: [...parsed.scopes] } : {}),
            ...(parsed.communityWide !== undefined ? { communityWide: parsed.communityWide } : {}),
            ...(statusChange === "suspended" ? { status: "suspended", suspendedAt: at } : {}),
            ...(statusChange === "active" ? { status: "active", suspendedAt: null } : {}),
            updatedAt: at,
          })
          .where(queries.where(agentIdentities, eq(agentIdentities.id, agent.id)));
        const action =
          statusChange === "suspended"
            ? "agent.suspended"
            : statusChange === "active"
              ? "agent.reactivated"
              : "agent.updated";
        await audit(queries, userId, action, agent.id, {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.scopes !== undefined ? { scopes: parsed.scopes } : {}),
          ...(parsed.communityWide !== undefined ? { communityWide: parsed.communityWide } : {}),
        });
      });
    },

    async revokeAgent(actor: Actor, communityId: string, agentId: string): Promise<void> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      await scoped(communityId, async (queries) => {
        const agent = await loadAgent(queries, agentId);
        assertCan(actor, "manage", "agent", agentManageContext(role, agent, userId));
        if (agent.status === "revoked") {
          return;
        }
        const at = now();
        await queries.tx
          .update(agentIdentities)
          .set({ status: "revoked", revokedAt: at, updatedAt: at })
          .where(queries.where(agentIdentities, eq(agentIdentities.id, agent.id)));
        const tokens = await queries.tx
          .update(apiTokens)
          .set({ revokedAt: at, revokedBy: userId })
          .where(
            queries.where(apiTokens, eq(apiTokens.agentId, agent.id), isNull(apiTokens.revokedAt)),
          )
          .returning({ id: apiTokens.id });
        await audit(queries, userId, "agent.revoked", agent.id, {
          tokensRevoked: tokens.length,
        });
      });
    },

    async agentNames(
      communityId: string,
      agentIds: readonly string[],
    ): Promise<Map<string, string>> {
      if (agentIds.length === 0) {
        return new Map();
      }
      return scoped(communityId, async (queries) => {
        const rows = await queries.tx
          .select({ id: agentIdentities.id, name: agentIdentities.name })
          .from(agentIdentities)
          .where(queries.where(agentIdentities, inArray(agentIdentities.id, [...agentIds])));
        return new Map(rows.map((row) => [row.id, row.name]));
      });
    },

    revokeAllCredentials(userId: string): Promise<RevokedCredentials> {
      return revokeAllCredentials(deps.db, userId, now());
    },

    async recordApiWrite(credential: ApiCredential, userId: string, write: ApiWrite) {
      if (auditEntriesWritten() > 0) {
        return;
      }
      await scoped(credential.communityId, (queries) =>
        audit(queries, userId, apiWriteAction(write.operationId), write.path, {
          method: write.method,
          status: write.status,
          operationId: write.operationId,
        }),
      );
    },
  };
}

export type AgentsService = ReturnType<typeof createAgentsService>;

let defaultService: AgentsService | undefined;

export function getAgentsService(): AgentsService {
  defaultService ??= createAgentsService({ db: getDb() });
  return defaultService;
}
