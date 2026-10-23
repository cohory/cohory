import { createHmac, timingSafeEqual } from "node:crypto";

const maxTokenLength = 128;

export const minimumFillSeconds = 3;
export const formTokenLifetimeSeconds = 2 * 60 * 60;

export type FormTokenCheck = "ok" | "too_fast" | "expired" | "bad_token";

// The purpose keys the signature, so a token issued for one form is refused by another.
function sign(secret: string, purpose: string, issuedAt: string): string {
  const key = createHmac("sha256", secret).update(purpose).digest();
  return createHmac("sha256", key).update(issuedAt).digest("base64url");
}

export function createFormToken(secret: string, purpose: string, now: Date): string {
  const issuedAt = String(Math.floor(now.getTime() / 1000));
  return `${issuedAt}.${sign(secret, purpose, issuedAt)}`;
}

export function checkFormToken(
  secret: string,
  purpose: string,
  token: string,
  now: Date,
): FormTokenCheck {
  if (token.length > maxTokenLength) {
    return "bad_token";
  }
  const [issuedAt, signature, extra] = token.split(".");
  if (!issuedAt || !signature || extra !== undefined || !/^\d{1,12}$/.test(issuedAt)) {
    return "bad_token";
  }
  const expected = Buffer.from(sign(secret, purpose, issuedAt));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return "bad_token";
  }
  const elapsed = Math.floor(now.getTime() / 1000) - Number(issuedAt);
  if (elapsed < minimumFillSeconds) {
    return "too_fast";
  }
  return elapsed > formTokenLifetimeSeconds ? "expired" : "ok";
}
