import { parseLegalEnv } from "@cohory/config/legal";
import { parseAppUrl, parseEdition } from "@cohory/config/platform";
import { z } from "zod";

import { keyringFrom, parseKeyList, type Keyring } from "./crypto";
import { maxFeeBps, type Edition } from "./fee";

export class LiveKeyRefusedError extends Error {
  constructor() {
    super("live Stripe keys are only allowed when NODE_ENV is production");
    this.name = "LiveKeyRefusedError";
  }
}

const livePrefixes = ["sk_live_", "rk_live_"];

export function isLiveKey(key: string): boolean {
  return livePrefixes.some((prefix) => key.startsWith(prefix));
}

export function assertTestModeKey(key: string, nodeEnv: string | undefined): void {
  if (isLiveKey(key) && nodeEnv !== "production") {
    throw new LiveKeyRefusedError();
  }
}

export class ApiBaseUrlRefusedError extends Error {
  constructor() {
    super("STRIPE_API_BASE_URL is for test doubles and cannot be used with a live Stripe key");
    this.name = "ApiBaseUrlRefusedError";
  }
}

export function assertApiBaseUrlAllowed(key: string, apiBaseUrl: string | null | undefined): void {
  if (apiBaseUrl && isLiveKey(key)) {
    throw new ApiBaseUrlRefusedError();
  }
}

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalText = z.preprocess(blankToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: optionalText,
  PLATFORM_FEE_BPS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(0).max(maxFeeBps).default(200),
  ),
  STRIPE_SECRET_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^(sk|rk)_(test|live)_/)
      .optional(),
  ),
  STRIPE_WEBHOOK_SECRET: optionalText,
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalText,
  STRIPE_CONNECT_CLIENT_ID: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^ca_[A-Za-z0-9]+$/)
      .optional(),
  ),
  PAYMENTS_ENCRYPTION_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((value) => Buffer.from(value, "base64"))
      .refine((buffer) => buffer.length === 32, "must be 32 bytes encoded as base64")
      .optional(),
  ),
  PAYMENTS_ENCRYPTION_KEYS: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform(parseKeyList)
      .refine(
        (keys) => keys.length > 0 && keys.every((key) => key.length === 32),
        "must be a comma separated list of 32 byte keys encoded as base64",
      )
      .optional(),
  ),
  STRIPE_API_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  POLAR_API_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  COHORY_ENABLE_POLAR: z.preprocess(
    blankToUndefined,
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
});

function appUrlOf(source: Record<string, string | undefined>): string | null {
  const configured = [source["APP_URL"], source["BETTER_AUTH_URL"]].some(
    (value) => value !== undefined && value.trim() !== "",
  );
  return configured ? parseAppUrl(source) : null;
}

export interface PaymentsEnv {
  readonly edition: Edition;
  readonly platformFeeBps: number;
  readonly nodeEnv: string | undefined;
  readonly stripeSecretKey: string | null;
  readonly webhookSecrets: readonly string[];
  readonly connectClientId: string | null;
  readonly encryptionKeys: Keyring | null;
  readonly appUrl: string | null;
  readonly stripeApiBaseUrl: string | null;
  readonly polarApiBaseUrl: string | null;
  readonly polarEnabled: boolean;
  readonly creatorTermsVersion: string;
  // Cloud onboarding always creates a new connected account, which holds no existing
  // subscriptions to link (decision record 0042).
  readonly subscriptionLinking: boolean;
}

export function parsePaymentsEnv(
  source: Record<string, string | undefined> = process.env,
): PaymentsEnv {
  const env = envSchema.parse(source);
  if (env.STRIPE_SECRET_KEY) {
    assertTestModeKey(env.STRIPE_SECRET_KEY, env.NODE_ENV);
    assertApiBaseUrlAllowed(env.STRIPE_SECRET_KEY, env.STRIPE_API_BASE_URL);
  }
  const edition = parseEdition(source);
  return {
    edition,
    platformFeeBps: env.PLATFORM_FEE_BPS,
    nodeEnv: env.NODE_ENV,
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? null,
    webhookSecrets: [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
      (secret): secret is string => secret !== undefined,
    ),
    connectClientId: env.STRIPE_CONNECT_CLIENT_ID ?? null,
    encryptionKeys: keyringFrom([
      env.PAYMENTS_ENCRYPTION_KEYS ?? [],
      env.PAYMENTS_ENCRYPTION_KEY ? [env.PAYMENTS_ENCRYPTION_KEY] : [],
    ]),
    appUrl: appUrlOf(source),
    stripeApiBaseUrl: env.STRIPE_API_BASE_URL ?? null,
    polarApiBaseUrl: env.POLAR_API_BASE_URL ?? null,
    polarEnabled: env.COHORY_ENABLE_POLAR,
    creatorTermsVersion: parseLegalEnv(source).termsVersion,
    subscriptionLinking: edition === "community",
  };
}
