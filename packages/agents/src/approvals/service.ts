import {
  assertCan,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type ApiCredential,
} from "@cohory/authz";
import { appendAuditEntry, getDb, setRlsFlag } from "@cohory/db";
import { approvalRequests, type ApprovalRequest } from "@cohory/db/schema";
import {
  getAgentAccessNotifier,
  getApprovalNoticeReader,
  getApprovalNotifier,
} from "@cohory/notifications";
import { and, count, eq, gt, lte, ne, sql } from "drizzle-orm";

import { createDecisionMethods } from "./decisions";
import { createPurchaseMethods } from "./purchases";
import {
  createApprovalsContext,
  approvalTtlMs,
  maxPendingPerAgent,
  stuckApprovalMs,
  purchaseCategory,
  uuidPattern,
  requireUser,
  auditMetadata,
  type ProposalInput,
  type ApprovalsServiceDeps,
  type ApprovalListView,
} from "./service-context";
import { ApprovalsError } from "./errors";
import { toApprovalView, type ApprovalView } from "./views";

export {
  approvalTtlMs,
  maxDecisionNoteLength,
  maxPendingPerAgent,
  purchaseCategory,
  reauthWindowMs,
  stuckApprovalMs,
  type ApprovalListView,
  type ApprovalNoticeInput,
  type ApprovalsServiceDeps,
  type ClaimedRequest,
  type ClaimOptions,
  type ClaimOutcome,
  type DownloadClaim,
  type FinishOutcome,
  type ProposalInput,
  type PurchaseNoticeInput,
} from "./service-context";

export function createApprovalsService(deps: ApprovalsServiceDeps) {
  const ctx = createApprovalsContext(deps);
  const {
    now,
    newId,
    logError,
    scoped,
    roleIn,
    selectRows,
    loadOne,
    auditAs,
    expireInCommunity,
    readFilter,
  } = ctx;

  return {
    ...createDecisionMethods(ctx),
    ...createPurchaseMethods(ctx),

    async propose(
      credential: ApiCredential,
      ownerUserId: string,
      proposal: ProposalInput,
    ): Promise<ApprovalView> {
      const agentId = credential.agentId;
      if (credential.type !== "agent" || !agentId) {
        throw new ForbiddenError("propose", "approval");
      }
      const at = now();
      const view = await scoped(credential.communityId, async (q) => {
        await q.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${agentId}, 0))`);
        const [pending] = await q.tx
          .select({ value: count() })
          .from(approvalRequests)
          .where(
            q.where(
              approvalRequests,
              eq(approvalRequests.agentId, agentId),
              eq(approvalRequests.state, "pending"),
              gt(approvalRequests.expiresAt, at),
            ),
          );
        if ((pending?.value ?? 0) >= maxPendingPerAgent) {
          throw new ApprovalsError("limit_reached");
        }
        const [row] = await q.tx
          .insert(approvalRequests)
          .values(
            q.values({
              id: newId(),
              agentId,
              ownerId: ownerUserId,
              tokenId: credential.tokenId,
              operationId: proposal.operationId,
              method: proposal.method,
              path: proposal.path,
              category: proposal.category,
              input: proposal.input,
              summary: proposal.summary,
              diff: proposal.diff,
              expiresAt: new Date(at.getTime() + approvalTtlMs),
              createdAt: at,
              updatedAt: at,
            }),
          )
          .returning();
        if (!row) {
          throw new Error("approval insert returned no row");
        }
        await appendAuditEntry(q, {
          actorId: ownerUserId,
          action:
            proposal.category === purchaseCategory ? "purchase.proposed" : "approval.requested",
          target: row.id,
          metadata: auditMetadata(row),
          at,
        });
        return toApprovalView(await loadOne(q, row.id), at);
      });
      const notify =
        proposal.category === purchaseCategory
          ? deps.notifyBuyer &&
            (() =>
              deps.notifyBuyer?.({
                communityId: credential.communityId,
                userId: ownerUserId,
                actorId: ownerUserId,
                subjectType: "approval_request",
                subjectId: view.id,
                detail: `${view.agent.name} asks you to ${view.summary}. Nothing is charged until you finish checkout.`,
              }))
          : deps.notify &&
            (() =>
              deps.notify?.({
                communityId: credential.communityId,
                approvalId: view.id,
                ownerUserId,
                detail: `${view.agent.name} asks to ${view.summary}`,
              }));
      if (notify) {
        try {
          await notify();
        } catch (error: unknown) {
          logError("approval notification failed", {
            approvalId: view.id,
            name: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      return view;
    },

    async list(
      actor: Actor,
      communityId: string,
      which: ApprovalListView,
    ): Promise<ApprovalView[]> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "read", "approval", { role });
      return scoped(communityId, async (q) => {
        await expireInCommunity(q);
        const managed = ne(approvalRequests.category, purchaseCategory);
        const rows =
          which === "pending"
            ? await selectRows(q, [eq(approvalRequests.state, "pending"), managed])
            : await selectRows(q, [ne(approvalRequests.state, "pending"), managed], {
                order: "updated",
              });
        const at = now();
        return rows.map((row) => toApprovalView(row, at));
      });
    },

    async pendingCount(actor: Actor, communityId: string): Promise<number> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "read", "approval", { role });
      return scoped(communityId, async (q) => {
        const [row] = await q.tx
          .select({ value: count() })
          .from(approvalRequests)
          .where(
            q.where(
              approvalRequests,
              eq(approvalRequests.state, "pending"),
              gt(approvalRequests.expiresAt, now()),
              ne(approvalRequests.category, purchaseCategory),
            ),
          );
        return row?.value ?? 0;
      });
    },

    async listForActor(actor: Actor, communityId: string): Promise<ApprovalView[]> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      if (actor.kind !== "user") {
        throw new UnauthenticatedError();
      }
      const filter = readFilter(actor, role);
      return scoped(communityId, async (q) => {
        await expireInCommunity(q);
        const at = now();
        return (await selectRows(q, [filter])).map((row) => toApprovalView(row, at));
      });
    },

    async get(actor: Actor, communityId: string, approvalId: string): Promise<ApprovalView> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      if (actor.kind !== "user") {
        throw new UnauthenticatedError();
      }
      const filter = readFilter(actor, role);
      return scoped(communityId, async (q) => {
        await expireInCommunity(q);
        if (!uuidPattern.test(approvalId)) {
          throw new ApprovalsError("not_found");
        }
        const [row] = await selectRows(q, [eq(approvalRequests.id, approvalId), filter], {
          limit: 1,
        });
        if (!row) {
          throw new ApprovalsError("not_found");
        }
        return toApprovalView(row, now());
      });
    },

    async expireDue(): Promise<{ expired: number; interrupted: number }> {
      const at = now();
      const changed = await deps.db.transaction(async (tx) => {
        await setRlsFlag(tx, "approval_jobs");
        const expired = await tx
          .update(approvalRequests)
          .set({ state: "expired", updatedAt: at })
          .where(and(eq(approvalRequests.state, "pending"), lte(approvalRequests.expiresAt, at)))
          .returning();
        const interrupted = await tx
          .update(approvalRequests)
          .set({ state: "failed", errorCode: "interrupted", updatedAt: at })
          .where(
            and(
              eq(approvalRequests.state, "approved"),
              lte(approvalRequests.decidedAt, new Date(at.getTime() - stuckApprovalMs)),
            ),
          )
          .returning();
        return { expired, interrupted };
      });
      const byCommunity = new Map<string, { row: ApprovalRequest; action: string }[]>();
      for (const row of changed.expired) {
        byCommunity.set(row.communityId, [
          ...(byCommunity.get(row.communityId) ?? []),
          { row, action: "approval.expired" },
        ]);
      }
      for (const row of changed.interrupted) {
        byCommunity.set(row.communityId, [
          ...(byCommunity.get(row.communityId) ?? []),
          { row, action: "approval.failed" },
        ]);
      }
      for (const [communityId, entries] of byCommunity) {
        await scoped(communityId, async (q) => {
          for (const { row, action } of entries) {
            await auditAs(q, row, null, action, row.errorCode ? { errorCode: row.errorCode } : {});
          }
        });
      }
      return { expired: changed.expired.length, interrupted: changed.interrupted.length };
    },
  };
}

export type ApprovalsService = ReturnType<typeof createApprovalsService>;

let defaultService: ApprovalsService | undefined;

export function getApprovalsService(): ApprovalsService {
  defaultService ??= createApprovalsService({
    db: getDb(),
    notify: getApprovalNotifier(),
    notifyBuyer: getAgentAccessNotifier(),
    markNoticeRead: getApprovalNoticeReader(),
  });
  return defaultService;
}
