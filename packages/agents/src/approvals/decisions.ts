import { assertCan, ForbiddenError, roleMayPerform, type Actor } from "@cohory/authz";
import { approvalRequests } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";

import { ApprovalsError } from "./errors";
import { toApprovalView, type ApprovalView } from "./views";
import {
  reauthWindowMs,
  maxDecisionNoteLength,
  purchaseCategory,
  requireHuman,
  type ClaimedRequest,
  type ClaimOutcome,
  type ClaimOptions,
  type FinishOutcome,
  type ApprovalsContext,
} from "./service-context";

export function createDecisionMethods(ctx: ApprovalsContext) {
  const { now, clearNotice, scoped, roleIn, loadOne, auditAs, expireInCommunity } = ctx;

  return {
    async claim(
      actor: Actor,
      communityId: string,
      approvalId: string,
      options: ClaimOptions,
    ): Promise<ClaimOutcome> {
      const { userId } = requireHuman(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "decide", "approval", { role });
      const outcome = await scoped(
        communityId,
        async (
          q,
        ): Promise<
          ClaimOutcome | { readonly kind: "refused"; readonly code: "expired" | "agent_inactive" }
        > => {
          const row = await loadOne(q, approvalId, true);
          if (row.category === purchaseCategory) {
            throw new ApprovalsError("not_found");
          }
          const at = now();
          if (row.state !== "pending") {
            return { kind: "decided", view: toApprovalView(row, at) };
          }
          const action = options.requiredAction(row.operationId);
          if (action && !roleMayPerform(role, action)) {
            throw new ForbiddenError(action, "approval");
          }
          if (!options.signedInAt || at.getTime() - options.signedInAt.getTime() > reauthWindowMs) {
            throw new ApprovalsError("reauth_required");
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
                decisionNote: `The agent was ${row.agentStatus === "revoked" ? "revoked" : "paused"} before anyone approved this.`,
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
        await clearNotice(communityId, approvalId, userId);
        throw new ApprovalsError(outcome.code);
      }
      return outcome;
    },

    async finish(request: ClaimedRequest, outcome: FinishOutcome): Promise<ApprovalView> {
      const view = await scoped(request.communityId, async (q) => {
        const at = now();
        const owned = and(
          eq(approvalRequests.id, request.id),
          eq(approvalRequests.state, "approved"),
          eq(approvalRequests.decidedBy, request.approverId),
        );
        if (outcome.kind === "released") {
          await q.tx
            .update(approvalRequests)
            .set({ state: "pending", decidedBy: null, decidedAt: null, updatedAt: at })
            .where(q.where(approvalRequests, owned));
          return toApprovalView(await loadOne(q, request.id), at);
        }
        const [row] = await q.tx
          .update(approvalRequests)
          .set(
            outcome.kind === "executed"
              ? { state: "executed", executedAt: at, result: outcome.result, updatedAt: at }
              : {
                  state: "failed",
                  errorCode: outcome.errorCode,
                  result: outcome.result ?? null,
                  updatedAt: at,
                },
          )
          .where(q.where(approvalRequests, owned))
          .returning();
        if (row) {
          await auditAs(q, row, request.approverId, "approval.approved");
          await auditAs(
            q,
            row,
            request.approverId,
            outcome.kind === "executed" ? "approval.executed" : "approval.failed",
            outcome.kind === "failed" ? { errorCode: outcome.errorCode } : {},
          );
        }
        return toApprovalView(await loadOne(q, request.id), at);
      });
      if (outcome.kind !== "released") {
        await clearNotice(request.communityId, request.id, request.approverId);
      }
      return view;
    },

    async reject(
      actor: Actor,
      communityId: string,
      approvalId: string,
      note: string | null,
    ): Promise<ApprovalView> {
      const { userId } = requireHuman(actor);
      const role = await roleIn(communityId, userId);
      assertCan(actor, "decide", "approval", { role });
      const trimmed = note?.trim().slice(0, maxDecisionNoteLength) || null;
      const outcome = await scoped(communityId, async (q) => {
        const row = await loadOne(q, approvalId, true);
        if (row.category === purchaseCategory) {
          throw new ApprovalsError("not_found");
        }
        const at = now();
        if (row.state !== "pending") {
          return { expired: false, view: toApprovalView(row, at) };
        }
        if (row.expiresAt <= at) {
          await expireInCommunity(q);
          return { expired: true, view: null };
        }
        const [rejected] = await q.tx
          .update(approvalRequests)
          .set({
            state: "rejected",
            decidedBy: userId,
            decidedAt: at,
            decisionNote: trimmed,
            updatedAt: at,
          })
          .where(q.where(approvalRequests, eq(approvalRequests.id, row.id)))
          .returning();
        if (rejected) {
          await auditAs(q, rejected, userId, "approval.rejected", {
            note: trimmed !== null,
          });
        }
        return { expired: false, view: toApprovalView(await loadOne(q, row.id), at) };
      });
      await clearNotice(communityId, approvalId, userId);
      if (outcome.expired || !outcome.view) {
        throw new ApprovalsError("expired");
      }
      return outcome.view;
    },
  };
}
