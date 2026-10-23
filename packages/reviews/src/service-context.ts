import {
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import {
  communityIdSchema,
  getCommunityById,
  getMembership,
  newId,
  runInCommunity,
  withCommunity,
  type Community,
  type Membership,
  type ScopedQueries,
} from "@cohory/db";
import type { Review } from "@cohory/db/schema";
import type { z } from "zod";

import { reviewEligibility, type Eligibility } from "./eligibility";
import { ReviewNotFoundError, ReviewsDisabledError, ReviewsValidationError } from "./errors";
import * as queries from "./queries";
import { reviewIdSchema } from "./schemas";
import type { OwnReviewView } from "./views";
import type { ReviewsServiceDeps } from "./service";

export interface Access {
  readonly community: Community;
  readonly membership: Membership | null;
  readonly role: CommunityRole | null;
  readonly context: PolicyContext;
  readonly userId: string | null;
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ReviewsValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function requireUser(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor.userId;
}

export function excerpt(body: string): string {
  return body.length > 200 ? `${body.slice(0, 199)}…` : body;
}

export function createReviewsContext(deps: ReviewsServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;
  const rateLimit = deps.rateLimit ?? (() => undefined);

  async function load(actor: Actor, communityId: string): Promise<Access> {
    const parsed = communityIdSchema.safeParse(communityId);
    const community = parsed.success ? await getCommunityById(deps.db, parsed.data) : null;
    if (!community) {
      throw new ReviewNotFoundError();
    }
    const userId = actor.kind === "user" ? actor.userId : null;
    const membership = userId
      ? await getMembership(withCommunity(deps.db, community.id), userId)
      : null;
    const role = membership?.status === "active" ? membership.role : null;
    return {
      community,
      membership,
      role,
      userId,
      context: { role, communityPrivacy: community.privacy },
    };
  }

  function scoped<T>(access: Access, fn: (q: ScopedQueries) => Promise<T>): Promise<T> {
    return runInCommunity(withCommunity(deps.db, access.community.id), fn);
  }

  function requireEnabled(access: Access): void {
    if (!access.community.reviewsEnabled) {
      throw new ReviewsDisabledError();
    }
  }

  async function requireReview(q: ScopedQueries, reviewId: string) {
    const id = reviewIdSchema.safeParse(reviewId);
    const review = id.success ? await queries.findReview(q, id.data) : null;
    if (!review) {
      throw new ReviewNotFoundError();
    }
    return review;
  }

  async function requireVisibleReview(q: ScopedQueries, reviewId: string) {
    const review = await requireReview(q, reviewId);
    if (review.hiddenAt || review.authorRemovedAt) {
      throw new ReviewNotFoundError();
    }
    return review;
  }

  async function eligibilityOf(access: Access, userId: string): Promise<Eligibility> {
    const tenure = await deps.tenure(access.community.id, [userId]);
    return reviewEligibility({
      membershipActive: access.membership?.status === "active",
      tenure: tenure.get(userId) ?? null,
      now: now(),
    });
  }

  function ownView(review: Review): OwnReviewView {
    return {
      id: review.id,
      rating: review.rating,
      body: review.body,
      createdAt: review.createdAt,
      editedAt: review.editedAt,
      hiddenReason: review.hiddenReason,
    };
  }

  return {
    deps,
    now,
    makeId,
    rateLimit,
    load,
    scoped,
    requireEnabled,
    requireReview,
    requireVisibleReview,
    eligibilityOf,
    ownView,
  };
}

export type ReviewsContext = ReturnType<typeof createReviewsContext>;
