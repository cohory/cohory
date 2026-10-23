import { agentLicenseIds, maxSubmissionPayloadBytes } from "@cohory/db/schema";
import { z } from "zod";

import { EntitlementsValidationError } from "./errors";

export const delegationDays = 30;
export const expiryNoticeDays = 3;

const uuid = z.uuid({ error: "This id is not valid." });

export const createDelegationInputSchema = z.strictObject({
  courseId: uuid,
  agentId: z.uuid({ error: "Choose one of your agents." }),
});

export type CreateDelegationInput = z.input<typeof createDelegationInputSchema>;

export const courseAgentSettingsInputSchema = z
  .strictObject({
    allowAgentAccess: z.boolean(),
    licenseId: z.enum(agentLicenseIds, { error: "Choose license terms from the list." }),
    licenseText: z
      .string()
      .trim()
      .max(2000, { error: "Keep the terms under 2,000 characters." })
      .nullable()
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .refine((value) => value.licenseId !== "custom" || value.licenseText !== null, {
    path: ["licenseText"],
    error: "Write your terms, or choose terms from the list.",
  });

export type CourseAgentSettingsInput = z.input<typeof courseAgentSettingsInputSchema>;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

const textId = (label: string, max: number) =>
  z
    .string({ error: `Send ${label} as text.` })
    .trim()
    .min(1, { error: `Send ${label}.` })
    .max(max, { error: `Keep ${label} under ${max} characters.` });

export const submitAgentResultInputSchema = z.strictObject({
  courseId: uuid,
  lessonId: textId("the lesson id", 200),
  taskId: textId("the task id", 200),
  version: textId("the version", 64),
  runId: textId("the run id", 200),
  payload: z
    .json({ error: "Send the result as JSON." })
    .refine((value) => byteLength(value) <= maxSubmissionPayloadBytes, {
      error: `Keep the result under ${maxSubmissionPayloadBytes / 1024} KiB.`,
    }),
});

export type SubmitAgentResultInput = Omit<
  z.input<typeof submitAgentResultInputSchema>,
  "payload"
> & { readonly payload: unknown };

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EntitlementsValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
