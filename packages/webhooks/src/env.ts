import { hkdfSync } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  keyringFrom,
  parseKeyList,
  type KeyInput,
  type Keyring,
} from "@cohory/payments/crypto";
import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  WEBHOOKS_ENCRYPTION_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((value) => Buffer.from(value, "base64"))
      .refine((buffer) => buffer.length === 32, "must be 32 bytes encoded as base64")
      .optional(),
  ),
  WEBHOOKS_ENCRYPTION_KEYS: z.preprocess(
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
  BETTER_AUTH_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),
});

export function webhookKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Keyring {
  const parsed = envSchema.parse(env);
  const derived = parsed.BETTER_AUTH_SECRET
    ? Buffer.from(
        hkdfSync("sha256", parsed.BETTER_AUTH_SECRET, "cohory", "cohory.webhooks.secret.v1", 32),
      )
    : null;
  const keys = keyringFrom([
    parsed.WEBHOOKS_ENCRYPTION_KEYS ?? [],
    parsed.WEBHOOKS_ENCRYPTION_KEY ? [parsed.WEBHOOKS_ENCRYPTION_KEY] : [],
    derived ? [derived] : [],
  ]);
  if (!keys) {
    throw new Error("set WEBHOOKS_ENCRYPTION_KEY or BETTER_AUTH_SECRET to store webhook secrets");
  }
  return keys;
}

function context(endpointId: string): string {
  return `webhook-endpoint:${endpointId}`;
}

export function sealWebhookSecret(secret: string, key: KeyInput, endpointId: string): string {
  return encryptSecret(secret, key, context(endpointId));
}

export function openWebhookSecret(sealed: string, key: KeyInput, endpointId: string): string {
  return decryptSecret(sealed, key, context(endpointId));
}

export function webhookSecretContext(endpointId: string): string {
  return context(endpointId);
}
