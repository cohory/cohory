import {
  reportNoteMaxLength,
  reportReason,
  reviewBodyMaxLength,
  reviewBodyMinLength,
  reviewHiddenReason,
  reviewReplyMaxLength,
} from "@cohory/db/schema";
import { z } from "zod";

export const reviewsPageSize = 10;
export const reviewReportQueueLimit = 50;
export const reviewHiddenReasons = reviewHiddenReason.enumValues;
export const reviewReportReasons = reportReason.enumValues;

export const reviewHiddenReasonLabels: Readonly<
  Record<(typeof reviewHiddenReasons)[number], string>
> = {
  spam: "spam",
  abuse: "abuse",
  personal_data: "personal data",
  off_topic: "off topic",
};

const rating = z
  .int({ error: "Choose 1 to 5 stars." })
  .min(1, { error: "Choose 1 to 5 stars." })
  .max(5, { error: "Choose 1 to 5 stars." });

const body = z
  .string()
  .trim()
  .min(reviewBodyMinLength, {
    error: `Write at least ${reviewBodyMinLength} characters.`,
  })
  .max(reviewBodyMaxLength, {
    error: `Keep the review under ${reviewBodyMaxLength} characters.`,
  });

export const reviewInputSchema = z.strictObject({ rating, body });

export const replyInputSchema = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1, { error: "Write a reply." })
    .max(reviewReplyMaxLength, {
      error: `Keep the reply under ${reviewReplyMaxLength} characters.`,
    }),
});

export const reviewReportInputSchema = z.strictObject({
  reason: z.enum(reviewReportReasons, { error: "Choose why you are reporting this." }),
  note: z
    .string()
    .trim()
    .max(reportNoteMaxLength, { error: `Keep the note under ${reportNoteMaxLength} characters.` })
    .optional(),
});

export const hideReviewInputSchema = z.strictObject({
  reason: z.enum(reviewHiddenReasons, { error: "Choose why you are hiding this review." }),
});

export const listReviewsInputSchema = z.strictObject({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(reviewsPageSize),
});

export const reviewReportQueueInputSchema = z.strictObject({
  status: z.enum(["open", "closed"]).default("open"),
});

export const reviewIdSchema = z.uuid();

export type ReviewInput = z.input<typeof reviewInputSchema>;
export type ReplyInput = z.input<typeof replyInputSchema>;
export type ReviewReportInput = z.input<typeof reviewReportInputSchema>;
export type HideReviewInput = z.input<typeof hideReviewInputSchema>;
export type ListReviewsInput = z.input<typeof listReviewsInputSchema>;
export type ReviewReportQueueInput = z.input<typeof reviewReportQueueInputSchema>;
