import { assertCan, can, type Actor } from "@cohory/authz";
import { getDb, type Database } from "@cohory/db";
import type { Review } from "@cohory/db/schema";
import { getReviewNotifier } from "@cohory/notifications";
import { getPaymentsService } from "@cohory/payments";
import { getRateLimiter } from "@cohory/rate-limit";
import { logger } from "@cohory/infra/logger";

import { createModerationMethods } from "./moderation";
import { createReplyMethods } from "./replies";
import { createReviewsContext, parse, requireUser } from "./service-context";
import {
  eligibilityMessage,
  reviewerStatus,
  reviewerStatusLabel,
  type TenureFacts,
} from "./eligibility";
import { NotEligibleError } from "./errors";
import * as queries from "./queries";
import {
  listReviewsInputSchema,
  reviewInputSchema,
  type HideReviewInput,
  type ListReviewsInput,
  type ReplyInput,
  type ReviewInput,
  type ReviewReportInput,
  type ReviewReportQueueInput,
} from "./schemas";
import type {
  RatingCount,
  ReviewPage,
  ReviewReportQueue,
  ReviewSummary,
  ReviewView,
  ReviewViewerState,
} from "./views";

export type TenureLookup = (
  communityId: string,
  userIds: readonly string[],
) => Promise<ReadonlyMap<string, TenureFacts>>;

export interface ReviewNotice {
  readonly communityId: string;
  readonly reviewId: string;
  readonly authorId: string;
  readonly rating: number;
}

export type ReviewsRateLimit = (rule: "comment" | "report", userId: string) => void;

export interface ReviewsServiceDeps {
  readonly db: Database;
  readonly tenure: TenureLookup;
  readonly notifyOwner?: (notice: ReviewNotice) => Promise<void>;
  readonly rateLimit?: ReviewsRateLimit;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly onNotifyError?: (error: unknown) => void;
}

export interface ReviewMutation {
  readonly id: string;
}

export interface ReviewsService {
  getSummary(actor: Actor, communityId: string): Promise<ReviewSummary>;
  listReviews(actor: Actor, communityId: string, input?: ListReviewsInput): Promise<ReviewPage>;
  getViewerState(actor: Actor, communityId: string): Promise<ReviewViewerState>;
  createReview(actor: Actor, communityId: string, input: ReviewInput): Promise<ReviewMutation>;
  updateReview(
    actor: Actor,
    communityId: string,
    reviewId: string,
    input: ReviewInput,
  ): Promise<ReviewMutation>;
  deleteReview(actor: Actor, communityId: string, reviewId: string): Promise<void>;
  replyToReview(
    actor: Actor,
    communityId: string,
    reviewId: string,
    input: ReplyInput,
  ): Promise<void>;
  updateReply(
    actor: Actor,
    communityId: string,
    reviewId: string,
    input: ReplyInput,
  ): Promise<void>;
  deleteReply(actor: Actor, communityId: string, reviewId: string): Promise<void>;
  reportReview(
    actor: Actor,
    communityId: string,
    reviewId: string,
    input: ReviewReportInput,
  ): Promise<{ readonly status: "received" }>;
  listReviewReports(
    actor: Actor,
    communityId: string,
    input?: ReviewReportQueueInput,
  ): Promise<ReviewReportQueue>;
  countOpenReviewReports(actor: Actor, communityId: string): Promise<number>;
  hideReview(
    actor: Actor,
    communityId: string,
    reviewId: string,
    input: HideReviewInput,
  ): Promise<void>;
  dismissReviewReports(
    actor: Actor,
    communityId: string,
    reviewId: string,
  ): Promise<{ readonly resolved: number }>;
}

const ratings = [5, 4, 3, 2, 1] as const;
export const minimumReviewsForAverage = 3;

export function createReviewsService(deps: ReviewsServiceDeps): ReviewsService {
  const ctx = createReviewsContext(deps);
  const {
    now,
    makeId,
    rateLimit,
    load,
    scoped,
    requireEnabled,
    requireReview,
    eligibilityOf,
    ownView,
  } = ctx;

  return {
    ...createReplyMethods(ctx),
    ...createModerationMethods(ctx),

    async getSummary(actor, communityId) {
      const access = await load(actor, communityId);
      assertCan(actor, "read", "review", access.context);
      if (!access.community.reviewsEnabled) {
        return { status: "disabled" };
      }
      return scoped(access, async (q) => {
        const [summary, hidden] = await Promise.all([
          queries.ratingSummary(q),
          queries.hiddenCounts(q),
        ]);
        const counts: RatingCount[] = ratings.map((rating) => ({
          rating,
          count: summary.ratings.get(rating) ?? 0,
        }));
        return {
          status: "enabled",
          count: summary.count,
          average:
            summary.count >= minimumReviewsForAverage && summary.average !== null
              ? Math.round(summary.average * 10) / 10
              : null,
          ratings: counts,
          hidden,
        };
      });
    },

    async listReviews(actor, communityId, input = {}) {
      const { rating, cursor, limit } = parse(listReviewsInputSchema, input);
      const after = cursor ? queries.decodeReviewCursor(cursor) : undefined;
      const access = await load(actor, communityId);
      assertCan(actor, "read", "review", access.context);
      if (!access.community.reviewsEnabled) {
        return { data: [], nextCursor: null };
      }
      const fetched = await scoped(access, (q) =>
        queries.listVisible(q, { rating, limit: limit + 1, after }),
      );
      const rows = fetched.slice(0, limit);
      const last = fetched.length > limit ? rows.at(-1) : undefined;
      const authorOf = (review: Review): string | null =>
        review.anonymizedAt ? null : review.authorId;
      const authorIds = rows.flatMap(({ review }) => {
        const author = authorOf(review);
        return author ? [author] : [];
      });
      const tenure = await deps.tenure(access.community.id, authorIds);
      const at = now();
      const data: ReviewView[] = rows.map(({ review, authorName, authorImage, reply }) => {
        const author = authorOf(review);
        const status = reviewerStatus(author ? (tenure.get(author) ?? null) : null, at);
        return {
          id: review.id,
          rating: review.rating,
          body: review.body,
          author: author
            ? { id: author, name: authorName ?? "Former member", image: authorImage }
            : { id: null, name: "Former member", image: null },
          status,
          statusLabel: reviewerStatusLabel(status),
          createdAt: review.createdAt,
          editedAt: review.editedAt,
          reply,
        };
      });
      return {
        data,
        nextCursor: last
          ? queries.encodeReviewCursor({ createdAt: last.review.createdAt, id: last.review.id })
          : null,
      };
    },

    async getViewerState(actor, communityId) {
      const access = await load(actor, communityId);
      assertCan(actor, "read", "review", access.context);
      const enabled = access.community.reviewsEnabled;
      const signedIn = actor.kind === "user";
      const canReply = can(actor, "reply", "review", access.context);
      if (!enabled || !access.userId) {
        return {
          enabled,
          signedIn,
          ownReview: null,
          eligibility: null,
          eligibilityMessage: null,
          canReply: enabled && canReply,
          canReport: enabled && can(actor, "report", "review", access.context),
          canHide: enabled && can(actor, "hide", "review", access.context),
        };
      }
      const userId = access.userId;
      const own = await scoped(access, (q) => queries.findReviewByAuthor(q, userId));
      const eligibility = can(actor, "create", "review", access.context)
        ? await eligibilityOf(access, userId)
        : null;
      return {
        enabled,
        signedIn,
        ownReview: own ? ownView(own) : null,
        eligibility,
        eligibilityMessage: eligibility
          ? eligibilityMessage(eligibility)
          : eligibilityMessage({ eligible: false, reason: "not_member", eligibleFrom: null }),
        canReply,
        canReport: can(actor, "report", "review", access.context),
        canHide: can(actor, "hide", "review", access.context),
      };
    },

    async createReview(actor, communityId, input) {
      const userId = requireUser(actor);
      const parsed = parse(reviewInputSchema, input);
      const access = await load(actor, communityId);
      requireEnabled(access);
      assertCan(actor, "create", "review", access.context);
      const eligibility = await eligibilityOf(access, userId);
      if (!eligibility.eligible) {
        throw new NotEligibleError(eligibilityMessage(eligibility) ?? "");
      }
      rateLimit("comment", userId);
      const at = now();
      const review = await scoped(access, async (q) => {
        const created = await queries.insertReview(q, {
          id: makeId(),
          authorId: userId,
          membershipId: access.membership?.id ?? null,
          rating: parsed.rating,
          body: parsed.body,
          createdAt: at,
        });
        await queries.appendReviewEvent(q, "review.created", {
          reviewId: created.id,
          authorId: userId,
          rating: created.rating,
        });
        return created;
      });
      if (deps.notifyOwner) {
        try {
          await deps.notifyOwner({
            communityId: access.community.id,
            reviewId: review.id,
            authorId: userId,
            rating: review.rating,
          });
        } catch (error: unknown) {
          deps.onNotifyError?.(error);
        }
      }
      return { id: review.id };
    },

    async updateReview(actor, communityId, reviewId, input) {
      const userId = requireUser(actor);
      const parsed = parse(reviewInputSchema, input);
      const access = await load(actor, communityId);
      requireEnabled(access);
      return scoped(access, async (q) => {
        const review = await requireReview(q, reviewId);
        assertCan(actor, "edit", "review", {
          ...access.context,
          ownsResource: review.authorId === userId,
        });
        if (review.rating === parsed.rating && review.body === parsed.body) {
          return { id: review.id };
        }
        await queries.updateReview(q, review.id, {
          rating: parsed.rating,
          body: parsed.body,
          editedAt: now(),
        });
        await queries.appendReviewEvent(q, "review.updated", {
          reviewId: review.id,
          authorId: userId,
          rating: parsed.rating,
        });
        return { id: review.id };
      });
    },

    async deleteReview(actor, communityId, reviewId) {
      const userId = requireUser(actor);
      const access = await load(actor, communityId);
      await scoped(access, async (q) => {
        const review = await requireReview(q, reviewId);
        assertCan(actor, "delete", "review", {
          ...access.context,
          ownsResource: review.authorId === userId,
        });
        await queries.deleteReview(q, review.id);
        await queries.appendReviewEvent(q, "review.deleted", { reviewId: review.id });
      });
    },
  };
}

let defaultService: ReviewsService | undefined;

export function getReviewsService(): ReviewsService {
  defaultService ??= createReviewsService({
    db: getDb(),
    tenure: (communityId, userIds) =>
      getPaymentsService().listSubscriberTenure(communityId, userIds),
    notifyOwner: async (notice) => {
      await getReviewNotifier()(notice);
    },
    rateLimit: (rule, userId) => getRateLimiter().consume(rule, userId),
    onNotifyError: (error) =>
      logger.error(
        { name: error instanceof Error ? error.name : "unknown" },
        "review notification failed",
      ),
  });
  return defaultService;
}
