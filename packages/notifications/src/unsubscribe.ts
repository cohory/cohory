import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { deliveredNotificationTypes, type DeliveredNotificationType } from "./types";

export type UnsubscribeScope = DeliveredNotificationType | "daily" | "weekly";

export interface UnsubscribeClaim {
  readonly userId: string;
  readonly scope: UnsubscribeScope;
}

const scopeSchema = z.enum([...deliveredNotificationTypes, "daily", "weekly"]);

const claimSchema = z.discriminatedUnion("v", [
  z.strictObject({ v: z.literal(1), u: z.uuid(), s: scopeSchema }),
  z.strictObject({ v: z.literal(2), u: z.uuid(), s: scopeSchema, i: z.number().int().positive() }),
]);

export const unsubscribeLinkValidityDays = 365;
const validityMs = unsubscribeLinkValidityDays * 24 * 60 * 60 * 1000;
const legacyIssuedAt = Date.parse("2026-10-19T00:00:00.000Z");
const clockSkewMs = 5 * 60 * 1000;

const purpose = "cohory.notifications.unsubscribe.v1";

function keyFrom(secret: string): Buffer {
  return createHmac("sha256", secret).update(purpose).digest();
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function createUnsubscribeToken(
  secret: string,
  claim: UnsubscribeClaim,
  issuedAt: Date = new Date(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 2,
      u: claim.userId,
      s: claim.scope,
      i: Math.floor(issuedAt.getTime() / 1000),
    }),
  ).toString("base64url");
  return `${body}.${sign(keyFrom(secret), body)}`;
}

export function verifyUnsubscribeToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): UnsubscribeClaim | null {
  if (token.length > 512) {
    return null;
  }
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) {
    return null;
  }
  const expected = Buffer.from(sign(keyFrom(secret), body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = claimSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const issuedAt = parsed.data.v === 2 ? parsed.data.i * 1000 : legacyIssuedAt;
  const at = now.getTime();
  if (issuedAt > at + clockSkewMs || at - issuedAt > validityMs) {
    return null;
  }
  return { userId: parsed.data.u, scope: parsed.data.s };
}

const secretSchema = z.object({ BETTER_AUTH_SECRET: z.string().min(32) });

export function unsubscribeSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return secretSchema.parse(env).BETTER_AUTH_SECRET;
}
