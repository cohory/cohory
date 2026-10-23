import { assertCan } from "@cohory/authz";

import { ReplyExistsError, ReviewNotFoundError } from "./errors";
import * as queries from "./queries";
import { replyInputSchema } from "./schemas";
import type { ReviewsService } from "./service";
import { parse, requireUser, type ReviewsContext } from "./service-context";

export function createReplyMethods(
  ctx: ReviewsContext,
): Pick<ReviewsService, "replyToReview" | "updateReply" | "deleteReply"> {
  const { now, makeId, load, scoped, requireEnabled, requireReview, requireVisibleReview } = ctx;

  return {
    async replyToReview(actor, communityId, reviewId, input) {
      const userId = requireUser(actor);
      const { body } = parse(replyInputSchema, input);
      const access = await load(actor, communityId);
      requireEnabled(access);
      assertCan(actor, "reply", "review", access.context);
      await scoped(access, async (q) => {
        const review = await requireVisibleReview(q, reviewId);
        const created = await queries.insertReply(q, {
          id: makeId(),
          reviewId: review.id,
          authorId: userId,
          body,
          createdAt: now(),
        });
        if (!created) {
          throw new ReplyExistsError();
        }
      });
    },

    async updateReply(actor, communityId, reviewId, input) {
      requireUser(actor);
      const { body } = parse(replyInputSchema, input);
      const access = await load(actor, communityId);
      requireEnabled(access);
      assertCan(actor, "reply", "review", access.context);
      await scoped(access, async (q) => {
        const review = await requireReview(q, reviewId);
        if (!(await queries.updateReply(q, review.id, { body, editedAt: now() }))) {
          throw new ReviewNotFoundError();
        }
      });
    },

    async deleteReply(actor, communityId, reviewId) {
      requireUser(actor);
      const access = await load(actor, communityId);
      assertCan(actor, "reply", "review", access.context);
      await scoped(access, async (q) => {
        const review = await requireReview(q, reviewId);
        if (!(await queries.deleteReply(q, review.id))) {
          throw new ReviewNotFoundError();
        }
      });
    },
  };
}
