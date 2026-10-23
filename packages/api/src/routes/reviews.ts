import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { reportNoteMaxLength, reviewBodyMaxLength, reviewReplyMaxLength } from "@cohory/db/schema";
import {
  reviewHiddenReasons,
  reviewReportReasons,
  type ReviewPage,
  type ReviewReportQueue,
  type ReviewSummary,
  type ReviewsService,
} from "@cohory/reviews";
import { bodyLimit } from "hono/body-limit";

import { resolveActor, type SessionResolver } from "../middleware/session";
import { createRouter } from "../create-router";
import { cursorPage, cursorQuery, pageCursor } from "../pagination";
import { routeMeta } from "../route-meta";
import { errorResponse, json, slugParams, tooManyRequests } from "./posts-schemas";

const jsonLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface ReviewsRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  reviews: ReviewsService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Reviews"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse(
    "The caller may not do this, is not eligible to review, or used an API token for a write.",
  ),
  404: errorResponse("The community or review does not exist or is not visible."),
  409: errorResponse(
    "Reviews are off, the member already reviewed, the review already has a reply, or the review has no open report.",
  ),
  422: errorResponse("The input is invalid."),
};
const sessionOnly =
  " Needs a signed in session: API and agent tokens can never write reviews, reply, report, or hide.";

const reviewParams = slugParams.extend({
  reviewId: z.uuid().openapi({ param: { name: "reviewId", in: "path" } }),
});

const reviewSchema = z
  .object({
    id: z.uuid(),
    rating: z.int().min(1).max(5),
    body: z.string(),
    author: z.object({
      id: z.uuid().nullable().openapi({ description: "Null when the account was erased." }),
      name: z.string(),
      image: z.string().nullable(),
    }),
    statusLabel: z.string().openapi({
      description: 'Computed when read: "Paying member for N months" or "Former member".',
    }),
    createdAt: z.iso.datetime(),
    editedAt: z.iso.datetime().nullable(),
    reply: z
      .object({
        body: z.string(),
        createdAt: z.iso.datetime(),
        editedAt: z.iso.datetime().nullable(),
      })
      .nullable(),
  })
  .openapi("Review");

const reviewPageSchema = cursorPage(reviewSchema).openapi("ReviewPage");

const summarySchema = z
  .union([
    z.object({ status: z.literal("disabled") }),
    z.object({
      status: z.literal("enabled"),
      count: z.int(),
      average: z.number().nullable().openapi({
        description: "Rounded to one decimal. Null until there are at least 3 visible reviews.",
      }),
      ratings: z.array(z.object({ rating: z.int().min(1).max(5), count: z.int() })),
      hidden: z.array(z.object({ reason: z.enum(reviewHiddenReasons), count: z.int() })),
    }),
  ])
  .openapi("ReviewSummary");

const listQuerySchema = z.object({
  rating: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .openapi({ param: { name: "rating", in: "query" }, description: "Only this many stars." }),
  ...cursorQuery({ max: 50, example: 10 }),
});

const reviewBodySchema = z
  .object({
    rating: z.int().min(1).max(5),
    body: z.string().min(20).max(reviewBodyMaxLength),
  })
  .openapi("ReviewInput");

const replyBodySchema = z
  .object({ body: z.string().min(1).max(reviewReplyMaxLength) })
  .openapi("ReviewReplyInput");

const reportBodySchema = z
  .object({
    reason: z.enum(reviewReportReasons),
    note: z.string().max(reportNoteMaxLength).optional(),
  })
  .openapi("ReviewReportInput");

const hideBodySchema = z.object({ reason: z.enum(reviewHiddenReasons) }).openapi("HideReviewInput");

const idSchema = z.object({ id: z.uuid() }).openapi("ReviewId");
const receiptSchema = z.object({ status: z.literal("received") }).openapi("ReviewReportReceipt");
const resolvedSchema = z.object({ resolved: z.int() }).openapi("ReviewReportResolution");

const reportQueueSchema = z
  .object({
    data: z.array(
      z.object({
        reviewId: z.uuid(),
        rating: z.int(),
        excerpt: z.string(),
        authorName: z.string(),
        status: z.enum(["open", "dismissed", "hidden"]),
        reportCount: z.int(),
        reasons: z.array(z.enum(reviewReportReasons)),
        notes: z.array(z.string()),
        firstReportedAt: z.iso.datetime(),
        lastReportedAt: z.iso.datetime(),
        hiddenReason: z.enum(reviewHiddenReasons).nullable(),
      }),
    ),
    ...pageCursor,
    openCount: z.int(),
  })
  .openapi("ReviewReportQueue");

const reportQueueQuerySchema = z.object({
  status: z
    .enum(["open", "closed"])
    .optional()
    .openapi({ param: { name: "status", in: "query" }, description: "open (default) or closed." }),
});

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function pageJson(page: ReviewPage): z.infer<typeof reviewPageSchema> {
  return {
    data: page.data.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: review.body,
      author: { ...review.author },
      statusLabel: review.statusLabel,
      createdAt: review.createdAt.toISOString(),
      editedAt: iso(review.editedAt),
      reply: review.reply
        ? {
            body: review.reply.body,
            createdAt: review.reply.createdAt.toISOString(),
            editedAt: iso(review.reply.editedAt),
          }
        : null,
    })),
    nextCursor: page.nextCursor,
  };
}

function summaryJson(summary: ReviewSummary): z.infer<typeof summarySchema> {
  if (summary.status === "disabled") {
    return summary;
  }
  return {
    ...summary,
    ratings: summary.ratings.map((row) => ({ ...row })),
    hidden: summary.hidden.map((row) => ({ ...row })),
  };
}

function queueJson(queue: ReviewReportQueue): z.infer<typeof reportQueueSchema> {
  return {
    openCount: queue.openCount,
    data: queue.data.map((group) => ({
      ...group,
      reasons: [...group.reasons],
      notes: [...group.notes],
      firstReportedAt: group.firstReportedAt.toISOString(),
      lastReportedAt: group.lastReportedAt.toISOString(),
    })),
    nextCursor: null,
  };
}

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});

const listReviews = createRoute({
  method: "get",
  path: "/communities/{slug}/reviews",
  operationId: "listReviews",
  "x-cohory": routeMeta("listReviews"),
  tags,
  security,
  summary: "List reviews",
  description:
    "Visible reviews of the community, newest first, 10 per page by default (limit up to 50), optionally only one star rating. Pass nextCursor as cursor for the next page. Reviews of removed or banned members and reviews the owner hid are left out. Empty while the owner has reviews turned off. Anyone who can see the About page can read them.",
  request: { params: slugParams, query: listQuerySchema },
  responses: { 200: json(reviewPageSchema, "A page of reviews."), ...errors },
});

const getReviewSummary = createRoute({
  method: "get",
  path: "/communities/{slug}/reviews/summary",
  operationId: "getReviewSummary",
  "x-cohory": routeMeta("getReviewSummary"),
  tags,
  security,
  summary: "Get the review summary",
  description:
    'Count, average, and count per star rating of the visible reviews, and how many reviews the owner hid for each reason. Answers `{ status: "disabled" }` while reviews are off.',
  request: { params: slugParams },
  responses: { 200: json(summarySchema, "The summary or the disabled state."), ...errors },
});

const createReview = createRoute({
  method: "post",
  path: "/communities/{slug}/reviews",
  operationId: "createReview",
  "x-cohory": routeMeta("createReview"),
  tags,
  security,
  summary: "Write a review",
  description: `1 to 5 stars and 20 to 2000 characters. Members who have paid for at least 30 days can leave a review: an active, paid, recurring subscription to the community. Trials, past due subscriptions, one time purchases, and comped access do not count. One review per member; the owner is notified.${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(reviewBodySchema) },
  responses: { 201: json(idSchema, "The new review."), 429: tooManyRequests, ...errors },
});

const updateReview = createRoute({
  method: "patch",
  path: "/communities/{slug}/reviews/{reviewId}",
  operationId: "updateReview",
  "x-cohory": routeMeta("updateReview"),
  tags,
  security,
  summary: "Edit your review",
  description: `Changes the stars and text of the caller's own review and marks it edited. Nobody else, the owner included, can edit it.${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams, ...jsonBody(reviewBodySchema) },
  responses: { 200: json(idSchema, "The review."), ...errors },
});

const deleteReview = createRoute({
  method: "delete",
  path: "/communities/{slug}/reviews/{reviewId}",
  operationId: "deleteReview",
  "x-cohory": routeMeta("deleteReview"),
  tags,
  security,
  summary: "Delete your review",
  description: `Deletes the caller's own review and its reply. The member can post a new one later while eligible.${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams },
  responses: { 204: { description: "Deleted." }, ...errors },
});

const replyDescription = `The owner can post one public reply per review, edit it, and delete it. Owner only.${sessionOnly}`;

const replyToReview = createRoute({
  method: "put",
  path: "/communities/{slug}/reviews/{reviewId}/reply",
  operationId: "replyToReview",
  "x-cohory": routeMeta("replyToReview"),
  tags,
  security,
  summary: "Reply to a review",
  description: replyDescription,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams, ...jsonBody(replyBodySchema) },
  responses: { 204: { description: "Replied." }, ...errors },
});

const updateReviewReply = createRoute({
  method: "patch",
  path: "/communities/{slug}/reviews/{reviewId}/reply",
  operationId: "updateReviewReply",
  "x-cohory": routeMeta("updateReviewReply"),
  tags,
  security,
  summary: "Edit your reply",
  description: replyDescription,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams, ...jsonBody(replyBodySchema) },
  responses: { 204: { description: "Edited." }, ...errors },
});

const deleteReviewReply = createRoute({
  method: "delete",
  path: "/communities/{slug}/reviews/{reviewId}/reply",
  operationId: "deleteReviewReply",
  "x-cohory": routeMeta("deleteReviewReply"),
  tags,
  security,
  summary: "Delete your reply",
  description: replyDescription,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams },
  responses: { 204: { description: "Deleted." }, ...errors },
});

const reportReview = createRoute({
  method: "post",
  path: "/communities/{slug}/reviews/{reviewId}/report",
  operationId: "reportReview",
  "x-cohory": routeMeta("reportReview"),
  tags,
  security,
  summary: "Report a review",
  description: `Sends the review to the moderation queue. Anyone signed in can report, except the author. Rate limited (RATE_LIMIT_REPORTS).${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams, ...jsonBody(reportBodySchema) },
  responses: { 200: json(receiptSchema, "Received."), 429: tooManyRequests, ...errors },
});

const hideReview = createRoute({
  method: "post",
  path: "/communities/{slug}/reviews/{reviewId}/hide",
  operationId: "hideReview",
  "x-cohory": routeMeta("hideReview"),
  tags,
  security,
  summary: "Hide a reported review",
  description: `Hides a review that has an open report, with a reason (spam, abuse, personal_data, off_topic). Closes its reports and writes the audit log. The About page then says how many reviews the owner hid and why. Owner only; a review without a report cannot be hidden.${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams, ...jsonBody(hideBodySchema) },
  responses: { 204: { description: "Hidden." }, ...errors },
});

const listReviewReports = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/review-reports",
  operationId: "listReviewReports",
  "x-cohory": routeMeta("listReviewReports"),
  tags,
  security,
  summary: "List reported reviews",
  description:
    "Reported reviews grouped per review, newest report first, up to 50. Moderators, admins, and owners.",
  request: { params: slugParams, query: reportQueueQuerySchema },
  responses: { 200: json(reportQueueSchema, "The reported reviews."), ...errors },
});

const dismissReviewReports = createRoute({
  method: "post",
  path: "/communities/{slug}/reviews/{reviewId}/dismiss-reports",
  operationId: "dismissReviewReports",
  "x-cohory": routeMeta("dismissReviewReports"),
  tags,
  security,
  summary: "Dismiss reports on a review",
  description: `Closes the open reports on the review without hiding it. Written to the audit log. Moderators, admins, and owners.${sessionOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: reviewParams },
  responses: { 200: json(resolvedSchema, "The number of reports closed."), ...errors },
});

export function createReviewsRoutes(getDeps: () => ReviewsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/reviews", actor);
  app.use("/communities/:slug/reviews/*", actor);
  app.use("/communities/:slug/manage/review-reports", actor);

  const reviews = () => getDeps().reviews;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(getReviewSummary, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(summaryJson(await reviews().getSummary(caller, id)), 200);
    })
    .openapi(listReviews, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(pageJson(await reviews().listReviews(caller, id, c.req.valid("query"))), 200);
    })
    .openapi(createReview, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(await reviews().createReview(caller, id, c.req.valid("json")), 201);
    })
    .openapi(updateReview, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await reviews().updateReview(caller, id, reviewId, c.req.valid("json")), 200);
    })
    .openapi(deleteReview, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      await reviews().deleteReview(caller, await communityId(caller, slug), reviewId);
      return c.body(null, 204);
    })
    .openapi(replyToReview, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      await reviews().replyToReview(caller, id, reviewId, c.req.valid("json"));
      return c.body(null, 204);
    })
    .openapi(updateReviewReply, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      await reviews().updateReply(caller, id, reviewId, c.req.valid("json"));
      return c.body(null, 204);
    })
    .openapi(deleteReviewReply, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      await reviews().deleteReply(caller, await communityId(caller, slug), reviewId);
      return c.body(null, 204);
    })
    .openapi(reportReview, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await reviews().reportReview(caller, id, reviewId, c.req.valid("json")), 200);
    })
    .openapi(hideReview, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      await reviews().hideReview(caller, id, reviewId, c.req.valid("json"));
      return c.body(null, 204);
    })
    .openapi(dismissReviewReports, async (c) => {
      const caller = c.get("actor");
      const { slug, reviewId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await reviews().dismissReviewReports(caller, id, reviewId), 200);
    })
    .openapi(listReviewReports, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(
        queueJson(await reviews().listReviewReports(caller, id, c.req.valid("query"))),
        200,
      );
    });
}
