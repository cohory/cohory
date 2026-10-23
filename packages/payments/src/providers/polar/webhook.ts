import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError } from "../../stripe-gateway";

export const webhookToleranceMs = 5 * 60_000;

export interface StandardWebhookHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export function signingKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) {
    const decoded = Buffer.from(secret.slice("whsec_".length), "base64");
    if (decoded.length > 0) {
      keys.unshift(decoded);
    }
  }
  return keys;
}

function sign(key: Buffer, id: string, timestamp: string, rawBody: string): Buffer {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
}

export function signStandardWebhook(
  secret: string,
  id: string,
  at: Date,
  rawBody: string,
): Record<string, string> {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const [key] = signingKeys(secret);
  if (!key) {
    throw new WebhookSignatureError();
  }
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${sign(key, id, timestamp, rawBody).toString("base64")}`,
  };
}

export function verifyStandardWebhook(
  rawBody: string,
  headers: StandardWebhookHeaders,
  secret: string,
  now: Date,
): string {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
    throw new WebhookSignatureError();
  }
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > webhookToleranceMs) {
    throw new WebhookSignatureError();
  }
  const given = signature
    .split(" ")
    .map((entry) => entry.split(","))
    .filter(([version, value]) => version === "v1" && value)
    .map(([, value]) => Buffer.from(value ?? "", "base64"));
  for (const key of signingKeys(secret)) {
    const expected = sign(key, id, timestamp, rawBody);
    if (
      given.some((value) => value.length === expected.length && timingSafeEqual(value, expected))
    ) {
      return id;
    }
  }
  throw new WebhookSignatureError();
}
