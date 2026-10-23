import type { ReviewHiddenReason } from "@cohory/db/schema";
import type { ReviewPage, ReviewReportQueue, ReviewSummary, ReviewView } from "@cohory/reviews";

export interface ReviewRow {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly authorName: string;
  readonly authorImage: string | null;
  readonly statusLabel: string;
  readonly createdAt: string;
  readonly edited: boolean;
  readonly own: boolean;
  readonly reply: { readonly body: string; readonly edited: boolean } | null;
}

export interface ReviewPageRows {
  readonly rows: readonly ReviewRow[];
  readonly nextCursor: string | null;
}

export const hiddenReasonLabels: Readonly<Record<ReviewHiddenReason, string>> = {
  spam: "spam",
  abuse: "abuse",
  personal_data: "personal data",
  off_topic: "off topic",
};

export const hiddenReasonOrder: readonly ReviewHiddenReason[] = [
  "spam",
  "abuse",
  "personal_data",
  "off_topic",
];

export function toReviewRow(review: ReviewView, viewerId: string | null): ReviewRow {
  return {
    id: review.id,
    rating: review.rating,
    body: review.body,
    authorName: review.author.name,
    authorImage: review.author.image,
    statusLabel: review.statusLabel,
    createdAt: review.createdAt.toISOString(),
    edited: review.editedAt !== null,
    own: viewerId !== null && review.author.id === viewerId,
    reply: review.reply
      ? { body: review.reply.body, edited: review.reply.editedAt !== null }
      : null,
  };
}

export function toReviewPageRows(page: ReviewPage, viewerId: string | null): ReviewPageRows {
  return {
    rows: page.data.map((review) => toReviewRow(review, viewerId)),
    nextCursor: page.nextCursor,
  };
}

export function reviewCountLabel(count: number): string {
  return count === 1 ? "1 review" : `${count} reviews`;
}

export function hiddenLines(summary: ReviewSummary): string[] {
  if (summary.status === "disabled") {
    return [];
  }
  return summary.hidden.map(
    ({ reason, count }) =>
      `${count === 1 ? "1 review" : `${count} reviews`} hidden by the owner for: ${hiddenReasonLabels[reason]}`,
  );
}

export function averageLabel(average: number): string {
  return average.toFixed(1);
}

export interface ReviewReportRow {
  readonly reviewId: string;
  readonly rating: number;
  readonly excerpt: string;
  readonly authorName: string;
  readonly status: "open" | "dismissed" | "hidden";
  readonly reportCount: number;
  readonly reasons: readonly string[];
  readonly notes: readonly string[];
  readonly lastReportedAt: string;
  readonly hiddenReason: ReviewHiddenReason | null;
}

export function toReviewReportRows(queue: ReviewReportQueue): ReviewReportRow[] {
  return queue.data.map((group) => ({
    reviewId: group.reviewId,
    rating: group.rating,
    excerpt: group.excerpt,
    authorName: group.authorName,
    status: group.status,
    reportCount: group.reportCount,
    reasons: [...group.reasons],
    notes: [...group.notes],
    lastReportedAt: group.lastReportedAt.toISOString(),
    hiddenReason: group.hiddenReason,
  }));
}
