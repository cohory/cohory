import { compNoteMaxLength } from "@cohory/db/schema";
import { z } from "zod";

export const compListLimit = 200;
export const compExpiryBatch = 100;

export const grantCompInputSchema = z
  .strictObject({
    email: z.email({ error: "Enter an email address." }).max(254).optional(),
    userId: z.uuid().optional(),
    expiresAt: z.date().nullable().optional(),
    note: z
      .string()
      .trim()
      .max(compNoteMaxLength, { error: `Keep the note under ${compNoteMaxLength} characters.` })
      .optional(),
  })
  .refine((input) => (input.email === undefined) !== (input.userId === undefined), {
    error: "Choose a member or enter an email address.",
    path: ["email"],
  });

export type GrantCompInput = z.input<typeof grantCompInputSchema>;
