import { reportNoteMaxLength, reportReason } from "@cohory/db/schema";
import { z } from "zod";

export const reportReasons = reportReason.enumValues;
export const reportQueueLimit = 50;

export const reportInputSchema = z.strictObject({
  reason: z.enum(reportReasons, { error: "Choose why you are reporting this." }),
  note: z
    .string()
    .trim()
    .max(reportNoteMaxLength, { error: `Keep the note under ${reportNoteMaxLength} characters.` })
    .optional(),
});

export const reportTargetInputSchema = z.strictObject({
  type: z.enum(["post", "comment"]),
  id: z.uuid(),
});

export const reportQueueInputSchema = z.strictObject({
  status: z.enum(["open", "closed"]).default("open"),
});

export type ReportInput = z.input<typeof reportInputSchema>;
export type ReportTargetInput = z.input<typeof reportTargetInputSchema>;
export type ReportQueueInput = z.input<typeof reportQueueInputSchema>;
