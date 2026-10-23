import {
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
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
import {
  courseAgentSettings,
  courseDelegations,
  type AgentStatus,
  type CourseAgentSettingsRow,
  type CourseDelegation,
} from "@cohory/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { logger } from "@cohory/infra/logger";

import { resolveDelegatedAccess } from "../access";
import {
  getCommunityAccess,
  type CommunityAccess,
  type MembershipAccess,
} from "../community-access";
import { EntitlementsError } from "../errors";
import { defaultAgentLicenseId, licenseTerms } from "../licenses";
import type { CourseAgentSettingsView, DelegationState, DelegationView } from "../views";

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly status: AgentStatus;
}

export interface AgentAccessNotice {
  readonly communityId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly subjectType: "course_delegation";
  readonly subjectId: string;
  readonly detail: string;
}

export interface AgentDirectory {
  find(communityId: string, agentId: string): Promise<AgentSummary | null>;
  list(
    communityId: string,
    filter: { readonly ownerId?: string; readonly agentIds?: readonly string[] },
  ): Promise<AgentSummary[]>;
}

export type MembershipAccessReader = (
  communityId: string,
  userId: string,
) => Promise<MembershipAccess>;

export interface EntitlementsServiceDeps {
  readonly db: Database;
  readonly agents: AgentDirectory;
  readonly membershipAccess: MembershipAccessReader;
  readonly notify?: (notice: AgentAccessNotice) => Promise<unknown>;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly logError?: (message: string, fields: Record<string, unknown>) => void;
}

export interface Runtime {
  readonly db: Database;
  readonly agents: AgentDirectory;
  readonly membershipAccess: MembershipAccessReader;
  readonly notify: (notice: AgentAccessNotice) => Promise<unknown>;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}

export function createRuntime(deps: EntitlementsServiceDeps): Runtime {
  return {
    db: deps.db,
    agents: deps.agents,
    membershipAccess: deps.membershipAccess,
    notify: deps.notify ?? (() => Promise.resolve(0)),
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? defaultNewId,
    logError: deps.logError ?? ((message, fields) => logger.error({ ...fields }, message)),
  };
}

export const dayMs = 24 * 60 * 60 * 1000;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export function scoped<T>(
  runtime: Runtime,
  communityId: string,
  fn: (q: ScopedQueries) => Promise<T>,
): Promise<T> {
  if (!isUuid(communityId)) {
    throw new EntitlementsError("not_found");
  }
  return runInCommunity(withCommunity(runtime.db, parseCommunityId(communityId)), fn);
}

export async function roleIn(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<CommunityRole | null> {
  if (!isUuid(communityId)) {
    throw new EntitlementsError("not_found");
  }
  const membership = await getMembership(
    withCommunity(runtime.db, parseCommunityId(communityId)),
    userId,
  );
  return membership?.status === "active" ? membership.role : null;
}

export async function communityAccessOf(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<CommunityAccess> {
  if (!isUuid(communityId)) {
    throw new EntitlementsError("not_found");
  }
  return getCommunityAccess(
    withCommunity(runtime.db, parseCommunityId(communityId)),
    userId,
    runtime.now(),
  );
}

export async function humanAccessSince(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<Date | null> {
  if (!isUuid(communityId)) {
    return null;
  }
  const membership = await getMembership(
    withCommunity(runtime.db, parseCommunityId(communityId)),
    userId,
  );
  return membership?.status === "active" ? (membership.joinedAt ?? null) : null;
}

export function requireHuman(actor: Actor, action: string): { userId: string } {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  if (actor.credential?.type === "agent") {
    throw new EntitlementsError("redelegation_refused");
  }
  if (actor.credential) {
    throw new ForbiddenError(action, "delegation");
  }
  return { userId: actor.userId };
}

export async function audit(
  runtime: Runtime,
  q: ScopedQueries,
  actorId: string | null,
  action: string,
  target: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await appendAuditEntry(q, { actorId, action, target, metadata, at: runtime.now() });
}

export async function loadSettings(
  q: ScopedQueries,
  courseId: string,
): Promise<CourseAgentSettingsRow | null> {
  const [row] = await q.tx
    .select()
    .from(courseAgentSettings)
    .where(q.where(courseAgentSettings, eq(courseAgentSettings.courseId, courseId)))
    .limit(1);
  return row ?? null;
}

export function settingsView(
  courseId: string,
  row: CourseAgentSettingsRow | null,
): CourseAgentSettingsView {
  return {
    courseId,
    allowAgentAccess: row?.allowAgentAccess ?? false,
    license: licenseTerms(row?.licenseId ?? defaultAgentLicenseId, row?.licenseText ?? null),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function latestDelegation(
  q: ScopedQueries,
  courseId: string,
  agentId: string,
): Promise<CourseDelegation | null> {
  const [live] = await q.tx
    .select()
    .from(courseDelegations)
    .where(
      q.where(
        courseDelegations,
        eq(courseDelegations.courseId, courseId),
        eq(courseDelegations.agentId, agentId),
        isNull(courseDelegations.revokedAt),
      ),
    )
    .limit(1);
  if (live) {
    return live;
  }
  const [last] = await q.tx
    .select()
    .from(courseDelegations)
    .where(
      q.where(
        courseDelegations,
        and(eq(courseDelegations.courseId, courseId), eq(courseDelegations.agentId, agentId)),
      ),
    )
    .orderBy(desc(courseDelegations.revokedAt))
    .limit(1);
  return last ?? null;
}

export interface StateFacts {
  readonly agent: AgentSummary | undefined;
  readonly humanAccess: MembershipAccess;
  readonly humanAccessSince: Date | null;
  readonly allowAgentAccess: boolean;
  readonly now: Date;
}

export function delegationState(row: CourseDelegation, facts: StateFacts): DelegationState {
  if (row.revokedAt && row.revokedReason) {
    return { kind: "ended", reason: row.revokedReason };
  }
  if (facts.humanAccessSince && row.grantedAt < facts.humanAccessSince) {
    return { kind: "ended", reason: "access_ended" };
  }
  const resolved = resolveDelegatedAccess({
    delegation: row,
    agentStatus: facts.agent?.status ?? null,
    humanAccess: facts.humanAccess,
    humanAccessSince: facts.humanAccessSince,
    allowAgentAccess: facts.allowAgentAccess,
    now: facts.now,
  });
  if (resolved.kind === "delegated") {
    return { kind: "active" };
  }
  if (resolved.reason === "expired") {
    return { kind: "ended", reason: "expired" };
  }
  return { kind: "paused", reason: resolved.reason };
}

export function delegationView(
  row: CourseDelegation,
  agent: AgentSummary | undefined,
  state: DelegationState,
): DelegationView {
  return {
    id: row.id,
    courseId: row.courseId,
    humanId: row.humanId,
    agent: { id: row.agentId, name: agent?.name ?? "Removed agent" },
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    renewedAt: row.renewedAt,
    revokedAt: row.revokedAt,
    state,
  };
}

export function isForeignKeyViolation(error: unknown): boolean {
  for (let candidate: unknown = error, depth = 0; candidate && depth < 3; depth += 1) {
    if (typeof candidate === "object" && "code" in candidate && candidate.code === "23503") {
      return true;
    }
    candidate = typeof candidate === "object" && "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
}

export async function notifySafely(runtime: Runtime, notice: AgentAccessNotice): Promise<boolean> {
  try {
    await runtime.notify(notice);
    return true;
  } catch (error: unknown) {
    runtime.logError("agent access notification failed", {
      subjectId: notice.subjectId,
      name: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
