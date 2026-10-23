import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const tokenPrefix = "cohory_";
export const tokenDisplayLength = 12;

const tokenPattern = /^cohory_[A-Za-z0-9_-]{43}$/;

export interface GeneratedToken {
  readonly token: string;
  readonly hash: string;
  readonly prefix: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isTokenFormat(value: string): boolean {
  return tokenPattern.test(value);
}

export function generateToken(): GeneratedToken {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, tokenDisplayLength) };
}

export function hashesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
