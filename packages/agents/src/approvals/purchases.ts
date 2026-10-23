import { type Actor, type ApiCredential } from "@cohory/authz";
import { appendAuditEntry } from "@cohory/db";
import { approvalRequests } from "@cohory/db/schema";
import { eq, gt, isNull, sql } from "drizzle-orm";

import { ApprovalsError } from "./errors";
import { downloadWindowMs, toApprovalView, type ApprovalView } from "./views";
import {
  purchaseCategory,
  uuidPattern,
  requireHuman,
  auditMetadata,
  type ClaimOutcome,
  type DownloadClaim,
  type ApprovalsContext,
} from "./service-context";

export function createPurchaseMethods(ctx: ApprovalsContext) {
  const { now, scoped, assertPurchaseOwner, selectRows, loadOne, auditAs, expireInCommunity } = ctx;

  return {
    async listPurchaseRequests(actor: Actor, communityId: string): Promise<ApprovalView[]> {
      const { userId } = requireHuman(actor);
      await assertPurchaseOwner(communityId, userId);
      return scoped(communityId, async (q) => {
        await expireInCommunity(q);
        const at = now();
        const rows = await selectRows(q, [
          eq(approvalRequests.category, purchaseCategory),
          eq(approvalRequests.ownerId, userId),
        ]);
        return rows.map((row) => toApprovalView(row, at));
      });
    },

    async claimPurchase(
      actor: Actor,
      communityId: string,
      approvalId: string,
    ): Promise<ClaimOutcome> {
      const { userId } = requireHuman(actor);
      await assertPurchaseOwner(communityId, userId);
      const outcome = await scoped(
        communityId,
        async (
          q,
        ): Promise<
          ClaimOutcome | { readonly kind: "refused"; readonly code: "expired" | "agent_inactive" }
        > => {
          const row = await loadOne(q, approvalId, true);
          if (row.category !== purchaseCategory || row.ownerId !== userId) {
            throw new ApprovalsError("not_found");
          }
          const at = now();
          if (row.state !== "pending") {
            return { kind: "decided", view: toApprovalView(row, at) };
          }
          if (row.expiresAt <= at) {
            await expireInCommunity(q);
            return { kind: "refused", code: "expired" };
          }
          if (row.agentStatus !== "active") {
            const [rejected] = await q.tx
              .update(approvalRequests)
              .set({
                state: "rejected",
                decidedBy: userId,
                decidedAt: at,
                decisionNote: "The agent was paused or revoked before you answered.",
                errorCode: "agent_inactive",
                updatedAt: at,
              })
              .where(q.where(approvalRequests, eq(approvalRequests.id, row.id)))
              .returning();
            if (rejected) {
              await auditAs(q, rejected, userId, "approval.rejected", { reason: "agent_inactive" });
            }
            return { kind: "refused", code: "agent_inactive" };
          }
          const [claimed] = await q.tx
            .update(approvalRequests)
            .set({ state: "approved", decidedBy: userId, decidedAt: at, updatedAt: at })
            .where(
              q.where(
                approvalRequests,
                eq(approvalRequests.id, row.id),
                eq(approvalRequests.state, "pending"),
              ),
            )
            .returning();
          if (!claimed) {
            return { kind: "decided", view: toApprovalView(await loadOne(q, row.id), at) };
          }
          return {
            kind: "claimed",
            request: {
              id: claimed.id,
              communityId: claimed.communityId,
              agentId: claimed.agentId,
              ownerId: claimed.ownerId,
              operationId: claimed.operationId,
              method: claimed.method,
              path: claimed.path,
              category: claimed.category,
              input: claimed.input,
              approverId: userId,
            },
          };
        },
      );
      if (outcome.kind === "refused") {
        throw new ApprovalsError(outcome.code);
      }
      return outcome;
    },

    async rejectPurchase(
      actor: Actor,
      communityId: string,
      approvalId: string,
    ): Promise<ApprovalView> {
      const { userId } = requireHuman(actor);
      await assertPurchaseOwner(communityId, userId);
      return scoped(communityId, async (q) => {
        const row = await loadOne(q, approvalId, true);
        if (row.category !== purchaseCategory || row.ownerId !== userId) {
          throw new ApprovalsError("not_found");
        }
        const at = now();
        if (row.state !== "pending") {
          return toApprovalView(row, at);
        }
        const [rejected] = await q.tx
          .update(approvalRequests)
          .set({ state: "rejected", decidedBy: userId, decidedAt: at, updatedAt: at })
          .where(q.where(approvalRequests, eq(approvalRequests.id, row.id)))
          .returning();
        if (rejected) {
          await auditAs(q, rejected, userId, "approval.rejected", {});
        }
        return toApprovalView(await loadOne(q, row.id), at);
      });
    },

    async claimDownload(credential: ApiCredential, approvalId: string): Promise<DownloadClaim> {
      if (credential.type !== "agent" || !credential.agentId || !uuidPattern.test(approvalId)) {
        throw new ApprovalsError("not_found");
      }
      const agentId = credential.agentId;
      return scoped(credential.communityId, async (q) => {
        const at = now();
        const [row] = await q.tx
          .update(approvalRequests)
          .set({ downloadedAt: at, updatedAt: at })
          .where(
            q.where(
              approvalRequests,
              eq(approvalRequests.id, approvalId),
              eq(approvalRequests.agentId, agentId),
              eq(approvalRequests.state, "executed"),
              isNull(approvalRequests.downloadedAt),
              sql`${approvalRequests.result} ->> 'download' = 'true'`,
              gt(approvalRequests.executedAt, new Date(at.getTime() - downloadWindowMs)),
            ),
          )
          .returning();
        if (!row || !row.decidedBy) {
          throw new ApprovalsError("download_unavailable");
        }
        await appendAuditEntry(q, {
          actorId: row.ownerId,
          action: "approval.downloaded",
          target: row.id,
          metadata: auditMetadata(row),
          at,
        });
        return {
          id: row.id,
          communityId: row.communityId,
          approverId: row.decidedBy,
          operationId: row.operationId,
          method: row.method,
          path: row.path,
          input: row.input,
        };
      });
    },

    async releaseDownload(claim: DownloadClaim): Promise<void> {
      await scoped(claim.communityId, async (q) => {
        await q.tx
          .update(approvalRequests)
          .set({ downloadedAt: null, updatedAt: now() })
          .where(q.where(approvalRequests, eq(approvalRequests.id, claim.id)));
      });
    },
  };
}
