import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { hashEmailAddress } from "./log";

export interface OptOutClaim {
  readonly addressHash: string;
  readonly communityId: string;
}

const claimSchema = z.strictObject({
  v: z.literal(1),
  h: z.string().regex(/^[0-9a-f]{64}$/),
  c: z.uuid(),
  i: z.number().int().positive(),
});

export const optOutLinkValidityDays = 365;
const validityMs = optOutLinkValidityDays * 24 * 60 * 60 * 1000;
const clockSkewMs = 5 * 60 * 1000;
const maxTokenLength = 512;

const purpose = "cohory.email.community-opt-out.v1";

function keyFrom(secret: string): Buffer {
  return createHmac("sha256", secret).update(purpose).digest();
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function createOptOutToken(
  secret: string,
  claim: OptOutClaim,
  issuedAt: Date = new Date(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      h: claim.addressHash,
      c: claim.communityId,
      i: Math.floor(issuedAt.getTime() / 1000),
    }),
  ).toString("base64url");
  return `${body}.${sign(keyFrom(secret), body)}`;
}

export function verifyOptOutToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): OptOutClaim | null {
  if (token.length > maxTokenLength) {
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
  const issuedAt = parsed.data.i * 1000;
  const at = now.getTime();
  if (issuedAt > at + clockSkewMs || at - issuedAt > validityMs) {
    return null;
  }
  return { addressHash: parsed.data.h, communityId: parsed.data.c };
}

export interface OptOutLinks {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export type OptOutLinker = (recipient: { to: string; communityId: string }) => OptOutLinks;

export function createOptOutLinker(options: {
  secret: string;
  appUrl: string;
  now?: () => Date;
}): OptOutLinker {
  const appUrl = options.appUrl.replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());
  return ({ to, communityId }) => {
    const token = createOptOutToken(
      options.secret,
      { addressHash: hashEmailAddress(to), communityId },
      now(),
    );
    return {
      url: `${appUrl}/email-opt-out?token=${token}`,
      headers: {
        "List-Unsubscribe": `<${appUrl}/api/email-opt-out?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  };
}

const secretSchema = z.object({ BETTER_AUTH_SECRET: z.string().min(32) });

export function optOutSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return secretSchema.parse(env).BETTER_AUTH_SECRET;
}
