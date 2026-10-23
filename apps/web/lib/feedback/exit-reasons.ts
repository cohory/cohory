import { exitReasonLabels } from "@cohory/notifications/creator-feedback/copy";
import { z } from "zod";

export type ExitReason = keyof typeof exitReasonLabels;

export const exitReasonValues = Object.keys(exitReasonLabels) as [ExitReason, ...ExitReason[]];

export function isExitReason(value: string): value is ExitReason {
  return Object.hasOwn(exitReasonLabels, value);
}

export { exitReasonLabels };

export const exitAnswerSchema = z
  .object({
    reason: z.enum(exitReasonValues).nullable().catch(null),
    comment: z.string().max(1000).catch(""),
  })
  .optional();
