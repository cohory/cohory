import { subscriberMoveSource } from "@cohory/db/schema";
import { z } from "zod";

export const moveBatchLimit = 1000;

export const addSubscriberMovesInputSchema = z.object({
  source: z.enum(subscriberMoveSource.enumValues).default("manual"),
  jobId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
  rows: z
    .array(
      z.object({
        email: z
          .email()
          .max(320)
          .transform((value) => value.toLowerCase()),
        freeUntil: z
          .date()
          .nullish()
          .transform((value) => value ?? null),
      }),
    )
    .min(1, "Add at least one email address.")
    .max(moveBatchLimit, `Add up to ${moveBatchLimit} people at a time.`)
    .refine((rows) => new Set(rows.map((row) => row.email)).size === rows.length, {
      message: "Each email address can appear only once.",
    }),
});

export type AddSubscriberMovesInput = z.input<typeof addSubscriberMovesInputSchema>;
