import { z } from "zod";

export const discoveryPageLimit = 50;

export const discoverSubscriptionsInputSchema = z.object({
  cursor: z
    .string()
    .regex(/^sub_[A-Za-z0-9_]+$/)
    .nullish()
    .transform((value) => value ?? null),
  limit: z.number().int().min(1).max(100).default(discoveryPageLimit),
});

export type DiscoverSubscriptionsInput = z.input<typeof discoverSubscriptionsInputSchema>;

export const linkBatchLimit = 100;

const linkRowSchema = z
  .object({
    subscriptionId: z.string().regex(/^sub_[A-Za-z0-9_]+$/),
    action: z.enum(["link_member", "link_and_add", "invite", "skip"]),
    interval: z.enum(["month", "year"]).nullish(),
  })
  .refine((row) => row.action === "skip" || row.interval, {
    path: ["interval"],
    message: "Choose monthly or yearly for every subscription you link or invite.",
  });

export const linkSubscriptionsInputSchema = z.object({
  rows: z
    .array(linkRowSchema)
    .min(1)
    .max(linkBatchLimit)
    .refine((rows) => new Set(rows.map((row) => row.subscriptionId)).size === rows.length, {
      message: "Each subscription can appear only once.",
    }),
  addPlatformFee: z.boolean().default(false),
});

export type LinkSubscriptionsInput = z.input<typeof linkSubscriptionsInputSchema>;
