import { appendAuditEntry, isUniqueViolation, type ScopedQueries } from "@cohory/db";
import {
  reviewReplies,
  reviewReports,
  reviews,
  users,
  type ReportReason,
  type Review,
  type ReviewHiddenReason,
  type ReviewReply,
  type ReviewReportStatus,
} from "@cohory/db/schema";
import { and, avg, count, desc, eq, isNotNull, isNull, max, min, ne, sql } from "drizzle-orm";

import { z } from "zod";

import { AlreadyReviewedError, ReviewsValidationError } from "./errors";

export interface ReviewCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const reviewCursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

export function encodeReviewCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString(
    "base64url",
  );
}

export function decodeReviewCursor(raw: string): ReviewCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = reviewCursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new ReviewsValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return { createdAt: new Date(parsed.data.c), id: parsed.data.i };
}

export type ReviewEventType =
  "review.created" | "review.updated" | "review.deleted" | "review.hidden";

export interface VisibleReviewRow {
  readonly review: Review;
  readonly authorName: string | null;
  readonly authorImage: string | null;
  readonly reply: Pick<ReviewReply, "body" | "createdAt" | "editedAt"> | null;
}

export interface ReportGroupRow {
  readonly reviewId: string;
  readonly rating: number;
  readonly body: string;
  readonly authorName: string | null;
  readonly hiddenReason: ReviewHiddenReason | null;
  readonly status: ReviewReportStatus;
  readonly reportCount: number;
  readonly reasons: ReportReason[];
  readonly notes: string[];
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
}

function first<T>(rows: readonly T[]): T | null {
  return rows[0] ?? null;
}

function visible(q: ScopedQueries, rating?: number) {
  return q.where(
    reviews,
    isNull(reviews.hiddenAt),
    isNull(reviews.authorRemovedAt),
    rating ? eq(reviews.rating, rating) : undefined,
  );
}

export async function findReview(q: ScopedQueries, reviewId: string): Promise<Review | null> {
  return first(
    await q.tx
      .select()
      .from(reviews)
      .where(q.where(reviews, eq(reviews.id, reviewId))),
  );
}

export async function findReviewByAuthor(
  q: ScopedQueries,
  authorId: string,
): Promise<Review | null> {
  return first(
    await q.tx
      .select()
      .from(reviews)
      .where(q.where(reviews, eq(reviews.authorId, authorId))),
  );
}

export async function insertReview(
  q: ScopedQueries,
  input: Pick<Review, "id" | "authorId" | "membershipId" | "rating" | "body" | "createdAt">,
): Promise<Review> {
  try {
    const [row] = await q.tx
      .insert(reviews)
      .values(q.values({ ...input, updatedAt: input.createdAt }))
      .returning();
    if (!row) {
      throw new Error("review insert returned no row");
    }
    return row;
  } catch (error: unknown) {
    if (isUniqueViolation(error, "reviews_one_per_member")) {
      throw new AlreadyReviewedError();
    }
    throw error;
  }
}

export async function updateReview(
  q: ScopedQueries,
  reviewId: string,
  patch: Pick<Review, "rating" | "body" | "editedAt">,
): Promise<Review | null> {
  return first(
    await q.tx
      .update(reviews)
      .set({ ...patch, updatedAt: patch.editedAt ?? new Date() })
      .where(q.where(reviews, eq(reviews.id, reviewId)))
      .returning(),
  );
}

export async function deleteReview(q: ScopedQueries, reviewId: string): Promise<void> {
  await q.tx.delete(reviews).where(q.where(reviews, eq(reviews.id, reviewId)));
}

export async function hideReview(
  q: ScopedQueries,
  reviewId: string,
  patch: { reason: ReviewHiddenReason; by: string; at: Date },
): Promise<void> {
  await q.tx
    .update(reviews)
    .set({
      hiddenAt: patch.at,
      hiddenReason: patch.reason,
      hiddenBy: patch.by,
      updatedAt: patch.at,
    })
    .where(q.where(reviews, eq(reviews.id, reviewId), isNull(reviews.hiddenAt)));
}

export async function listVisible(
  q: ScopedQueries,
  filter: { rating?: number; limit: number; after?: ReviewCursor },
): Promise<VisibleReviewRow[]> {
  const after = filter.after
    ? sql`(${reviews.createdAt}, ${reviews.id}) < (${filter.after.createdAt.toISOString()}::timestamptz, ${filter.after.id}::uuid)`
    : undefined;
  const rows = await q.tx
    .select({
      review: reviews,
      authorName: users.name,
      authorImage: users.image,
      replyBody: reviewReplies.body,
      replyCreatedAt: reviewReplies.createdAt,
      replyEditedAt: reviewReplies.editedAt,
    })
    .from(reviews)
    .leftJoin(users, eq(users.id, reviews.authorId))
    .leftJoin(
      reviewReplies,
      and(eq(reviewReplies.reviewId, reviews.id), eq(reviewReplies.communityId, q.communityId)),
    )
    .where(and(visible(q, filter.rating), after))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(filter.limit);
  return rows.map((row) => ({
    review: row.review,
    authorName: row.authorName,
    authorImage: row.authorImage,
    reply:
      row.replyBody !== null && row.replyCreatedAt !== null
        ? { body: row.replyBody, createdAt: row.replyCreatedAt, editedAt: row.replyEditedAt }
        : null,
  }));
}

export async function ratingSummary(
  q: ScopedQueries,
): Promise<{ count: number; average: number | null; ratings: Map<number, number> }> {
  const rows = await q.tx
    .select({ rating: reviews.rating, total: count() })
    .from(reviews)
    .where(visible(q))
    .groupBy(reviews.rating);
  const [overall] = await q.tx
    .select({ total: count(), average: avg(reviews.rating) })
    .from(reviews)
    .where(visible(q));
  return {
    count: overall?.total ?? 0,
    average:
      overall?.average === null || overall?.average === undefined ? null : Number(overall.average),
    ratings: new Map(rows.map((row) => [row.rating, row.total])),
  };
}

export async function hiddenCounts(
  q: ScopedQueries,
): Promise<{ reason: ReviewHiddenReason; count: number }[]> {
  const rows = await q.tx
    .select({ reason: reviews.hiddenReason, total: count() })
    .from(reviews)
    .where(q.where(reviews, isNotNull(reviews.hiddenAt), isNull(reviews.authorRemovedAt)))
    .groupBy(reviews.hiddenReason)
    .orderBy(reviews.hiddenReason);
  return rows.flatMap((row) => (row.reason ? [{ reason: row.reason, count: row.total }] : []));
}

export async function findReply(q: ScopedQueries, reviewId: string): Promise<ReviewReply | null> {
  return first(
    await q.tx
      .select()
      .from(reviewReplies)
      .where(q.where(reviewReplies, eq(reviewReplies.reviewId, reviewId))),
  );
}

export async function insertReply(
  q: ScopedQueries,
  input: Pick<ReviewReply, "id" | "reviewId" | "authorId" | "body" | "createdAt">,
): Promise<boolean> {
  const result = await q.tx
    .insert(reviewReplies)
    .values(q.values({ ...input, updatedAt: input.createdAt }))
    .onConflictDoNothing({ target: reviewReplies.reviewId });
  return (result.rowCount ?? 0) > 0;
}

export async function updateReply(
  q: ScopedQueries,
  reviewId: string,
  patch: { body: string; editedAt: Date },
): Promise<boolean> {
  const rows = await q.tx
    .update(reviewReplies)
    .set({ body: patch.body, editedAt: patch.editedAt, updatedAt: patch.editedAt })
    .where(q.where(reviewReplies, eq(reviewReplies.reviewId, reviewId)))
    .returning({ id: reviewReplies.id });
  return rows.length > 0;
}

export async function deleteReply(q: ScopedQueries, reviewId: string): Promise<boolean> {
  const rows = await q.tx
    .delete(reviewReplies)
    .where(q.where(reviewReplies, eq(reviewReplies.reviewId, reviewId)))
    .returning({ id: reviewReplies.id });
  return rows.length > 0;
}

export async function insertReport(
  q: ScopedQueries,
  input: {
    id: string;
    reviewId: string;
    reporterId: string;
    reason: ReportReason;
    note: string | null;
  },
): Promise<void> {
  await q.tx.insert(reviewReports).values(q.values(input)).onConflictDoNothing();
}

export async function countOpenReports(q: ScopedQueries, reviewId: string): Promise<number> {
  const [row] = await q.tx
    .select({ total: count() })
    .from(reviewReports)
    .where(
      q.where(
        reviewReports,
        eq(reviewReports.reviewId, reviewId),
        eq(reviewReports.status, "open"),
      ),
    );
  return row?.total ?? 0;
}

export async function resolveReports(
  q: ScopedQueries,
  reviewId: string,
  resolution: { status: Exclude<ReviewReportStatus, "open">; by: string; at: Date },
): Promise<number> {
  const rows = await q.tx
    .update(reviewReports)
    .set({
      status: resolution.status,
      resolvedBy: resolution.by,
      resolvedAt: resolution.at,
      updatedAt: resolution.at,
    })
    .where(
      q.where(
        reviewReports,
        eq(reviewReports.reviewId, reviewId),
        eq(reviewReports.status, "open"),
      ),
    )
    .returning({ id: reviewReports.id });
  return rows.length;
}

export async function listReportGroups(
  q: ScopedQueries,
  filter: { open: boolean; limit: number },
): Promise<ReportGroupRow[]> {
  const rows = await q.tx
    .select({
      reviewId: reviewReports.reviewId,
      rating: reviews.rating,
      body: reviews.body,
      authorName: users.name,
      hiddenReason: reviews.hiddenReason,
      status: reviewReports.status,
      reportCount: count(),
      reasons: sql<ReportReason[]>`array_agg(distinct ${reviewReports.reason})`,
      notes: sql<
        string[]
      >`coalesce(array_agg(${reviewReports.note}) filter (where ${reviewReports.note} is not null), '{}')`,
      firstReportedAt: min(reviewReports.createdAt),
      lastReportedAt: max(reviewReports.createdAt),
    })
    .from(reviewReports)
    .innerJoin(reviews, eq(reviews.id, reviewReports.reviewId))
    .leftJoin(users, eq(users.id, reviews.authorId))
    .where(
      q.where(
        reviewReports,
        filter.open ? eq(reviewReports.status, "open") : ne(reviewReports.status, "open"),
      ),
    )
    .groupBy(
      reviewReports.reviewId,
      reviewReports.status,
      reviews.rating,
      reviews.body,
      users.name,
      reviews.hiddenReason,
    )
    .orderBy(desc(max(reviewReports.createdAt)))
    .limit(filter.limit);
  return rows.map((row) => ({
    ...row,
    firstReportedAt: row.firstReportedAt ?? new Date(0),
    lastReportedAt: row.lastReportedAt ?? new Date(0),
  }));
}

export async function countOpenReportGroups(q: ScopedQueries): Promise<number> {
  const [row] = await q.tx
    .select({ total: sql<number>`count(distinct ${reviewReports.reviewId})::int` })
    .from(reviewReports)
    .where(q.where(reviewReports, eq(reviewReports.status, "open")));
  return row?.total ?? 0;
}

export async function appendReviewEvent(
  q: ScopedQueries,
  type: ReviewEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await q.tx.execute(
    sql`select cohory_append_domain_event(${q.communityId}::uuid, ${type}, ${JSON.stringify(payload)}::jsonb)`,
  );
}

export function audit(
  q: ScopedQueries,
  entry: {
    actorId: string;
    action: string;
    target: string;
    metadata: Record<string, unknown>;
    at: Date;
  },
): Promise<void> {
  return appendAuditEntry(q, entry);
}
