import { assertCan, ForbiddenError } from "@cohory/authz";

import { NotReportedError } from "./errors";
import * as queries from "./queries";
import {
  hideReviewInputSchema,
  reviewReportInputSchema,
  reviewReportQueueInputSchema,
  reviewReportQueueLimit,
} from "./schemas";
import type { ReviewsService } from "./service";
import { parse, requireUser, excerpt, type ReviewsContext } from "./service-context";

export function createModerationMethods(
  ctx: ReviewsContext,
): Pick<
  ReviewsService,
  | "reportReview"
  | "countOpenReviewReports"
  | "listReviewReports"
  | "hideReview"
  | "dismissReviewReports"
> {
  const {
    now,
    makeId,
    rateLimit,
    load,
    scoped,
    requireEnabled,
    requireReview,
    requireVisibleReview,
  } = ctx;

  return {
    async reportReview(actor, communityId, reviewId, input) {
      const userId = requireUser(actor);
      const { reason, note } = parse(reviewReportInputSchema, input);
      const access = await load(actor, communityId);
      requireEnabled(access);
      assertCan(actor, "report", "review", access.context);
      await scoped(access, async (q) => {
        const review = await requireVisibleReview(q, reviewId);
        if (review.authorId === userId) {
          throw new ForbiddenError("report", "review");
        }
        rateLimit("report", userId);
        await queries.insertReport(q, {
          id: makeId(),
          reviewId: review.id,
          reporterId: userId,
          reason,
          note: note ? note : null,
        });
      });
      return { status: "received" };
    },

    async countOpenReviewReports(actor, communityId) {
      const access = await load(actor, communityId);
      assertCan(actor, "review", "report", access.context);
      return scoped(access, (q) => queries.countOpenReportGroups(q));
    },

    async listReviewReports(actor, communityId, input = {}) {
      const { status } = parse(reviewReportQueueInputSchema, input);
      const access = await load(actor, communityId);
      assertCan(actor, "review", "report", access.context);
      return scoped(access, async (q) => {
        const [rows, openCount] = await Promise.all([
          queries.listReportGroups(q, { open: status === "open", limit: reviewReportQueueLimit }),
          queries.countOpenReportGroups(q),
        ]);
        return {
          data: rows.map((row) => ({
            reviewId: row.reviewId,
            rating: row.rating,
            excerpt: excerpt(row.body),
            authorName: row.authorName ?? "Former member",
            status: row.status,
            reportCount: row.reportCount,
            reasons: row.reasons,
            notes: row.notes,
            firstReportedAt: row.firstReportedAt,
            lastReportedAt: row.lastReportedAt,
            hiddenReason: row.hiddenReason,
          })),
          openCount,
        };
      });
    },

    async hideReview(actor, communityId, reviewId, input) {
      const userId = requireUser(actor);
      const { reason } = parse(hideReviewInputSchema, input);
      const access = await load(actor, communityId);
      assertCan(actor, "hide", "review", access.context);
      await scoped(access, async (q) => {
        const review = await requireVisibleReview(q, reviewId);
        if ((await queries.countOpenReports(q, review.id)) === 0) {
          throw new NotReportedError();
        }
        const at = now();
        await queries.hideReview(q, review.id, { reason, by: userId, at });
        const resolved = await queries.resolveReports(q, review.id, {
          status: "hidden",
          by: userId,
          at,
        });
        await queries.audit(q, {
          actorId: userId,
          action: "review.hidden",
          target: review.id,
          metadata: { reason, rating: review.rating, reports: resolved },
          at,
        });
        await queries.appendReviewEvent(q, "review.hidden", { reviewId: review.id, reason });
      });
    },

    async dismissReviewReports(actor, communityId, reviewId) {
      const userId = requireUser(actor);
      const access = await load(actor, communityId);
      assertCan(actor, "review", "report", access.context);
      return scoped(access, async (q) => {
        const review = await requireReview(q, reviewId);
        const at = now();
        const resolved = await queries.resolveReports(q, review.id, {
          status: "dismissed",
          by: userId,
          at,
        });
        if (resolved > 0) {
          await queries.audit(q, {
            actorId: userId,
            action: "review.reports_dismissed",
            target: review.id,
            metadata: { reports: resolved },
            at,
          });
        }
        return { resolved };
      });
    },
  };
}
