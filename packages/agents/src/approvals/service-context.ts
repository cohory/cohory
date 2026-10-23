import {
  can,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type ApprovalCategory,
  type CommunityRole,
  type PolicyAction,
} from "@cohory/authz";
import {
  appendAuditEntry,
  getMembership,
  newId as defaultNewId,
  parseCommunityId,
  runInCommunity,
  runWithAuditSource,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { agentIdentities, approvalRequests, users, type ApprovalRequest } from "@cohory/db/schema";
import { type ApprovalNoticeRead } from "@cohory/notifications";
import { desc, eq, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { logger } from "@cohory/infra/logger";

import { ApprovalsError } from "./errors";
import {
  type ApprovalDiffLine,
  type ApprovalRecordedInput,
  type ApprovalRow,
  type ApprovalView,
} from "./views";

export const approvalTtlMs = 72 * 60 * 60 * 1000;
export const maxPendingPerAgent = 20;
export const reauthWindowMs = 10 * 60 * 1000;
export const stuckApprovalMs = 15 * 60 * 1000;
export const maxDecisionNoteLength = 500;
export const purchaseCategory = "purchase";

export interface ProposalInput {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly category: ApprovalCategory;
  readonly input: ApprovalRecordedInput;
  readonly summary: string;
  readonly diff: readonly ApprovalDiffLine[];
}

export interface ApprovalNoticeInput {
  readonly communityId: string;
  readonly approvalId: string;
  readonly ownerUserId: string;
  readonly detail: string;
}

export interface PurchaseNoticeInput {
  readonly communityId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly subjectType: "approval_request";
  readonly subjectId: string;
  readonly detail: string;
}

export interface ApprovalsServiceDeps {
  readonly db: Database;
  readonly notify?: (notice: ApprovalNoticeInput) => Promise<unknown>;
  readonly notifyBuyer?: (notice: PurchaseNoticeInput) => Promise<unknown>;
  readonly markNoticeRead?: (read: ApprovalNoticeRead) => Promise<unknown>;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly logError?: (message: string, fields: Record<string, unknown>) => void;
}

export interface ClaimedRequest {
  readonly id: string;
  readonly communityId: string;
  readonly agentId: string;
  readonly ownerId: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly category: string;
  readonly input: ApprovalRecordedInput;
  readonly approverId: string;
}

export type ClaimOutcome =
  | { readonly kind: "claimed"; readonly request: ClaimedRequest }
  | { readonly kind: "decided"; readonly view: ApprovalView };

export interface ClaimOptions {
  readonly signedInAt: Date | null;
  readonly requiredAction: (operationId: string) => PolicyAction | null;
}

export type FinishOutcome =
  | { readonly kind: "executed"; readonly result: Record<string, unknown> }
  | {
      readonly kind: "failed";
      readonly errorCode: string;
      readonly result?: Record<string, unknown>;
    }
  | { readonly kind: "released" };

export interface DownloadClaim {
  readonly id: string;
  readonly communityId: string;
  readonly approverId: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly input: ApprovalRecordedInput;
}

export type ApprovalListView = "pending" | "history";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerUser = alias(users, "approval_owner");
const deciderUser = alias(users, "approval_decider");
const listLimit = 50;

export function requireUser(actor: Actor): { userId: string } {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return { userId: actor.userId };
}

export function requireHuman(actor: Actor): { userId: string } {
  const user = requireUser(actor);
  if (actor.kind === "user" && actor.credential) {
    throw new ForbiddenError("decide", "approval");
  }
  return user;
}

export function auditMetadata(row: ApprovalRequest, extra: Record<string, unknown> = {}) {
  return {
    approvalId: row.id,
    operationId: row.operationId,
    category: row.category,
    agentId: row.agentId,
    ownerUserId: row.ownerId,
    summary: row.summary,
    ...extra,
  };
}

export function createApprovalsContext(deps: ApprovalsServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;
  const logError =
    deps.logError ??
    ((message: string, fields: Record<string, unknown>) => logger.error({ ...fields }, message));

  async function clearNotice(communityId: string, approvalId: string, userId: string) {
    if (!deps.markNoticeRead) {
      return;
    }
    try {
      await deps.markNoticeRead({ communityId, approvalId, userId });
    } catch (error: unknown) {
      logError("approval notice read failed", {
        approvalId,
        name: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  function scoped<T>(communityId: string, fn: (q: ScopedQueries) => Promise<T>): Promise<T> {
    return runInCommunity(withCommunity(deps.db, parseCommunityId(communityId)), fn);
  }

  async function roleIn(communityId: string, userId: string): Promise<CommunityRole | null> {
    const membership = await getMembership(
      withCommunity(deps.db, parseCommunityId(communityId)),
      userId,
    );
    return membership?.status === "active" ? membership.role : null;
  }

  async function assertPurchaseOwner(communityId: string, userId: string): Promise<void> {
    const membership = await getMembership(
      withCommunity(deps.db, parseCommunityId(communityId)),
      userId,
    );
    if (!membership || membership.status === "banned") {
      throw new ForbiddenError("read_own", "approval");
    }
  }

  async function selectRows(
    q: ScopedQueries,
    conditions: (SQL | undefined)[],
    options: { limit?: number; order?: "created" | "updated"; lock?: boolean } = {},
  ): Promise<ApprovalRow[]> {
    const base = q.tx
      .select({
        request: approvalRequests,
        agentName: agentIdentities.name,
        agentStatus: agentIdentities.status,
        ownerName: ownerUser.name,
        decidedByName: deciderUser.name,
      })
      .from(approvalRequests)
      .innerJoin(agentIdentities, eq(agentIdentities.id, approvalRequests.agentId))
      .leftJoin(ownerUser, eq(ownerUser.id, approvalRequests.ownerId))
      .leftJoin(deciderUser, eq(deciderUser.id, approvalRequests.decidedBy))
      .where(q.where(approvalRequests, ...conditions))
      .orderBy(
        desc(options.order === "updated" ? approvalRequests.updatedAt : approvalRequests.createdAt),
        desc(approvalRequests.id),
      )
      .limit(options.limit ?? listLimit);
    const rows = options.lock ? await base.for("update", { of: approvalRequests }) : await base;
    return rows.map((row) => ({
      ...row.request,
      agentName: row.agentName,
      agentStatus: row.agentStatus,
      ownerName: row.ownerName,
      decidedByName: row.decidedByName,
    }));
  }

  async function loadOne(q: ScopedQueries, id: string, lock = false): Promise<ApprovalRow> {
    if (!uuidPattern.test(id)) {
      throw new ApprovalsError("not_found");
    }
    const [row] = await selectRows(q, [eq(approvalRequests.id, id)], { limit: 1, lock });
    if (!row) {
      throw new ApprovalsError("not_found");
    }
    return row;
  }

  async function auditAs(
    q: ScopedQueries,
    row: ApprovalRequest,
    actorId: string | null,
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const entry = {
      actorId,
      action,
      target: row.id,
      metadata: auditMetadata(row, extra),
      at: now(),
    };
    if (!actorId) {
      await appendAuditEntry(q, entry);
      return;
    }
    await runWithAuditSource(
      { actorType: "user", via: "web", tokenId: null, agentId: row.agentId },
      () => appendAuditEntry(q, entry),
    );
  }

  async function expireInCommunity(q: ScopedQueries): Promise<void> {
    const at = now();
    const expired = await q.tx
      .update(approvalRequests)
      .set({ state: "expired", updatedAt: at })
      .where(
        q.where(
          approvalRequests,
          eq(approvalRequests.state, "pending"),
          lte(approvalRequests.expiresAt, at),
        ),
      )
      .returning();
    for (const row of expired) {
      await auditAs(q, row, null, "approval.expired");
    }
  }

  function readFilter(
    actor: Actor & { kind: "user" },
    role: CommunityRole | null,
  ): SQL | undefined {
    if (actor.credential?.agentId) {
      return eq(approvalRequests.agentId, actor.credential.agentId);
    }
    if (can(actor, "read", "approval", { role })) {
      return undefined;
    }
    if (can(actor, "read_own", "approval", { role })) {
      return eq(approvalRequests.ownerId, actor.userId);
    }
    throw new ApprovalsError("not_found");
  }

  return {
    deps,
    now,
    newId,
    logError,
    clearNotice,
    scoped,
    roleIn,
    assertPurchaseOwner,
    selectRows,
    loadOne,
    auditAs,
    expireInCommunity,
    readFilter,
  };
}

export type ApprovalsContext = ReturnType<typeof createApprovalsContext>;
