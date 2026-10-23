import { maxJoinQuestions } from "@cohory/db/schema";
import { z } from "zod";

export const maxPriceMinor = 99_999_999;

const price = z.number().int().min(1).max(maxPriceMinor);

export const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Use a three letter currency code")
  .transform((value) => value.toLowerCase());

export const upsertPlanInputSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Membership"),
  currency: currencySchema,
  monthlyPriceMinor: price,
  annualPriceMinor: price.nullable().default(null),
});

export type UpsertPlanInput = z.input<typeof upsertPlanInputSchema>;

export const joinAnswerMaxLength = 1000;

export const checkoutInputSchema = z.object({
  interval: z.enum(["month", "year"]).default("month"),
  answers: z.array(z.string().trim().max(joinAnswerMaxLength)).max(maxJoinQuestions).default([]),
});

export type CheckoutInput = z.input<typeof checkoutInputSchema>;

export const ownKeysInputSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, "Paste a Stripe secret or restricted key"),
  webhookSecret: z
    .string()
    .trim()
    .regex(/^whsec_[A-Za-z0-9]+$/, "Paste the webhook signing secret that starts with whsec_"),
});

export type OwnKeysInput = z.input<typeof ownKeysInputSchema>;

export const byoProviderSchema = z.enum(["polar"]);

export type ByoProvider = z.output<typeof byoProviderSchema>;

export const connectProviderInputSchema = z.object({
  provider: byoProviderSchema,
  accessToken: z
    .string()
    .trim()
    .min(20, "Paste the full access token")
    .max(500, "Paste the access token only")
    .regex(/^\S+$/, "Paste the access token without spaces"),
  server: z.enum(["sandbox", "production"]).default("sandbox"),
});

export type ConnectProviderInput = z.input<typeof connectProviderInputSchema>;

export const providerWebhookSecretInputSchema = z.object({
  webhookSecret: z
    .string()
    .trim()
    .min(16, "Paste the full webhook secret")
    .max(500, "Paste the webhook secret only")
    .regex(/^\S+$/, "Paste the webhook secret without spaces"),
});

export type ProviderWebhookSecretInput = z.input<typeof providerWebhookSecretInputSchema>;

export const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "Use a two letter country code")
  .transform((value) => value.toLowerCase());

export const connectStripeInputSchema = z.object({
  email: z.email().nullable().default(null),
  country: countrySchema.nullable().default(null),
  acceptCreatorTerms: z.boolean().default(false),
});

export type ConnectStripeInput = z.input<typeof connectStripeInputSchema>;

export function isStripePortalLoginUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "billing.stripe.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    /^\/p\/login\/[A-Za-z0-9_]+$/.test(url.pathname)
  );
}

export const portalLoginUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(isStripePortalLoginUrl, "Paste your Stripe customer portal link from billing.stripe.com");

export const disconnectInputSchema = z.object({
  memberChoice: z.enum(["take_members", "wind_down"]).default("take_members"),
  includeLinked: z.boolean().default(true),
  portalLoginUrl: portalLoginUrlSchema.nullable().default(null),
});

export type DisconnectInput = z.input<typeof disconnectInputSchema>;
