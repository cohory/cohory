import { reportNoteMaxLength, reportReason } from "@cohory/db/schema";
import { z } from "zod";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const target = { type: z.enum(["post", "comment"]), id: z.uuid() };

export const reportContentSchema = z.object({
  slug,
  ...target,
  reason: z.enum(reportReason.enumValues, { error: "Choose why you are reporting this." }),
  note: z
    .string()
    .trim()
    .max(reportNoteMaxLength, { error: `Keep the note under ${reportNoteMaxLength} characters.` })
    .optional(),
});

export const moderateReportSchema = z.object({
  slug,
  ...target,
  decision: z.enum(["dismiss", "delete", "ban"]),
});

export type ReportContentInput = z.input<typeof reportContentSchema>;
export type ModerateReportInput = z.input<typeof moderateReportSchema>;
