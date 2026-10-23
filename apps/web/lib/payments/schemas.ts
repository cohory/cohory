import {
  cancelCommentMaxLength,
  maxPriceMinor,
  pauseMonthChoices,
  portalLoginUrlSchema,
} from "@cohory/payments";
import { stripeCurrencies } from "@cohory/payments/currency";
import { z } from "zod";

import { exitAnswerSchema } from "../feedback/exit-reasons";
import { cancelReasons } from "./cancel-reasons";

const slug = z.string().min(1).max(64);
const price = z
  .number()
  .int("Enter whole minor units.")
  .min(1, "Enter a price above zero.")
  .max(maxPriceMinor, "Enter a lower price.");

export const slugActionSchema = z.object({ slug });

export const billingPortalActionSchema = z.object({
  slug,
  returnTo: z.enum(["membership", "account"]).default("membership"),
});

export const disconnectActionSchema = z.object({
  slug,
  memberChoice: z.enum(["take_members", "wind_down"]).default("take_members"),
  includeLinked: z.boolean().default(true),
  portalLoginUrl: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(portalLoginUrlSchema.nullable())
    .nullable()
    .default(null),
  exit: exitAnswerSchema,
});

export type DisconnectActionInput = z.input<typeof disconnectActionSchema>;

export const connectStripeActionSchema = z.object({
  slug,
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .optional(),
  acceptCreatorTerms: z.boolean(),
});

export type ConnectStripeActionInput = z.input<typeof connectStripeActionSchema>;

export const checkoutActionSchema = z.object({
  slug,
  interval: z.enum(["month", "year"]).default("month"),
  answers: z.array(z.string().max(1000)).max(3).default([]),
});

export const cancelMembershipActionSchema = z.object({
  slug,
  feedback: z.enum(cancelReasons).nullable().default(null),
  comment: z
    .string()
    .max(cancelCommentMaxLength, `Keep it under ${cancelCommentMaxLength} characters.`)
    .default(""),
});

export type CancelMembershipActionInput = z.input<typeof cancelMembershipActionSchema>;

export const pauseMembershipActionSchema = z.object({
  slug,
  months: z.union(
    pauseMonthChoices.map((months) => z.literal(months)),
    {
      error: "Choose 1, 2, or 3 months.",
    },
  ),
});

export type PauseMembershipActionInput = z.input<typeof pauseMembershipActionSchema>;

export const savePlanActionSchema = z.object({
  slug,
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Choose a currency."),
  monthlyPriceMinor: price,
  annualPriceMinor: price.nullable(),
});

export const ownKeysActionSchema = z.object({
  slug,
  secretKey: z.string().trim().min(1, "Paste your Stripe secret key."),
  webhookSecret: z.string().trim().min(1, "Paste the webhook signing secret."),
});

export const connectProviderActionSchema = z.object({
  slug,
  provider: z.enum(["polar"]),
  accessToken: z.string().trim().min(1, "Paste the access token."),
  server: z.enum(["sandbox", "production"]).default("sandbox"),
});

export const providerSecretActionSchema = z.object({
  slug,
  webhookSecret: z.string().trim().min(1, "Paste the webhook signing secret."),
});

export const redirectUrlSchema = z.url({ protocol: /^https?$/ });

export const supportedCurrencies: readonly string[] = [
  "usd",
  ...stripeCurrencies.map((entry) => entry.code).filter((code) => code !== "usd"),
];

export type CheckoutActionInput = z.input<typeof checkoutActionSchema>;
export type SavePlanActionInput = z.input<typeof savePlanActionSchema>;
export type OwnKeysActionInput = z.input<typeof ownKeysActionSchema>;
export type SlugActionInput = z.input<typeof slugActionSchema>;
export type BillingPortalActionInput = z.input<typeof billingPortalActionSchema>;
export type ConnectProviderActionInput = z.input<typeof connectProviderActionSchema>;
export type ProviderSecretActionInput = z.input<typeof providerSecretActionSchema>;
