import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import {
  AlreadyReviewedError,
  NotEligibleError,
  ReviewNotFoundError,
  type ReviewsService,
} from "@cohory/reviews";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";
import { routeScopes } from "../route-meta";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

type Stub = { [K in keyof ReviewsService]: Mock<ReviewsService[K]> };

function createStub(): Stub {
  return {
    getSummary: vi.fn<ReviewsService["getSummary"]>(),
    listReviews: vi.fn<ReviewsService["listReviews"]>(),
    getViewerState: vi.fn<ReviewsService["getViewerState"]>(),
    createReview: vi.fn<ReviewsService["createReview"]>(),
    updateReview: vi.fn<ReviewsService["updateReview"]>(),
    deleteReview: vi.fn<ReviewsService["deleteReview"]>(),
    replyToReview: vi.fn<ReviewsService["replyToReview"]>(),
    updateReply: vi.fn<ReviewsService["updateReply"]>(),
    deleteReply: vi.fn<ReviewsService["deleteReply"]>(),
    reportReview: vi.fn<ReviewsService["reportReview"]>(),
    listReviewReports: vi.fn<ReviewsService["listReviewReports"]>(),
    countOpenReviewReports: vi.fn<ReviewsService["countOpenReviewReports"]>(),
    hideReview: vi.fn<ReviewsService["hideReview"]>(),
    dismissReviewReports: vi.fn<ReviewsService["dismissReviewReports"]>(),
  };
}

let reviews: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
const reviewId = newId();
const member = newId();

beforeEach(() => {
  const repo = createFakeRepository();
  const community = repo.addCommunity({ slug: communitySlugSchema.parse("makers") });
  communityId = community.id;
  repo.addMembership({ communityId, userId: member, role: "member" });
  reviews = createStub();
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts,
      reviews,
    }),
  );
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("review routes", () => {
  it("lists reviews with the star filter and cursor, and serializes dates", async () => {
    const createdAt = new Date("2026-10-01T10:00:00Z");
    reviews.listReviews.mockResolvedValue({
      data: [
        {
          id: reviewId,
          rating: 5,
          body: "Twenty characters or more here.",
          author: { id: member, name: "Ada", image: null },
          status: { kind: "paying", months: 7 },
          statusLabel: "Paying member for 7 months",
          createdAt,
          editedAt: null,
          reply: { body: "Thanks", createdAt, editedAt: null },
        },
      ],
      nextCursor: "next-page",
    });

    const response = await call("/reviews?rating=5&cursor=this-page&limit=5");

    expect(response.status).toBe(200);
    expect(reviews.listReviews).toHaveBeenCalledWith({ kind: "guest" }, communityId, {
      rating: 5,
      cursor: "this-page",
      limit: 5,
    });
    expect(await response.json()).toMatchObject({
      data: [
        {
          statusLabel: "Paying member for 7 months",
          createdAt: "2026-10-01T10:00:00.000Z",
          reply: { body: "Thanks", editedAt: null },
        },
      ],
      nextCursor: "next-page",
    });
  });

  it("returns the disabled summary while reviews are off", async () => {
    reviews.getSummary.mockResolvedValue({ status: "disabled" });
    const response = await call("/reviews/summary");
    expect(await response.json()).toEqual({ status: "disabled" });
  });

  it("creates a review for a session and validates stars and length first", async () => {
    reviews.createReview.mockResolvedValue({ id: reviewId });
    const body = { rating: 4, body: "Helpful calls every single week." };

    const created = await call("/reviews", { method: "POST", userId: member, body });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: reviewId });

    const invalid = await call("/reviews", {
      method: "POST",
      userId: member,
      body: { rating: 6, body: "short" },
    });
    expect(invalid.status).toBe(422);
    expect(reviews.createReview).toHaveBeenCalledTimes(1);
  });

  it("explains the eligibility rule with a 403", async () => {
    reviews.createReview.mockRejectedValue(
      new NotEligibleError("Members who have paid for at least 30 days can leave a review."),
    );
    const response = await call("/reviews", {
      method: "POST",
      userId: member,
      body: { rating: 4, body: "Helpful calls every single week." },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "not_eligible",
        message: "Members who have paid for at least 30 days can leave a review.",
      },
    });
  });

  it("maps a second review to 409 and a missing review to 404", async () => {
    reviews.createReview.mockRejectedValue(new AlreadyReviewedError());
    reviews.deleteReview.mockRejectedValue(new ReviewNotFoundError());
    const again = await call("/reviews", {
      method: "POST",
      userId: member,
      body: { rating: 4, body: "Helpful calls every single week." },
    });
    expect(again.status).toBe(409);
    const missing = await call(`/reviews/${reviewId}`, { method: "DELETE", userId: member });
    expect(missing.status).toBe(404);
  });

  it("passes owner replies, reports, and hides to the service", async () => {
    reviews.replyToReview.mockResolvedValue(undefined);
    reviews.reportReview.mockResolvedValue({ status: "received" });
    reviews.hideReview.mockResolvedValue(undefined);

    expect(
      (
        await call(`/reviews/${reviewId}/reply`, {
          method: "PUT",
          userId: member,
          body: { body: "Thank you" },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(`/reviews/${reviewId}/report`, {
          method: "POST",
          userId: member,
          body: { reason: "spam" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/reviews/${reviewId}/hide`, {
          method: "POST",
          userId: member,
          body: { reason: "personal_data" },
        })
      ).status,
    ).toBe(204);
    expect(reviews.hideReview).toHaveBeenCalledWith(
      expect.objectContaining({ userId: member }),
      communityId,
      reviewId,
      { reason: "personal_data" },
    );
  });

  it("keeps every review write session only and the reads token readable", () => {
    for (const operation of [
      "createReview",
      "updateReview",
      "deleteReview",
      "replyToReview",
      "updateReviewReply",
      "deleteReviewReply",
      "reportReview",
      "hideReview",
      "dismissReviewReports",
    ] as const) {
      expect(routeScopes[operation].scope).toBeNull();
    }
    expect(routeScopes.listReviews).toEqual({ scope: "community:read", action: "review.read" });
    expect(routeScopes.getReviewSummary).toEqual({
      scope: "community:read",
      action: "review.read",
    });
  });
});
