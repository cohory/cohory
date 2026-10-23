import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { hashToken } from "../token";

export const refreshTokenPrefix = "cohoryrt_";

const refreshPattern = /^cohoryrt_[A-Za-z0-9_-]{43}$/;
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

export interface Secret {
  readonly value: string;
  readonly hash: string;
}

function secret(prefix: string): Secret {
  const value = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { value, hash: hashToken(value) };
}

export function generateRefreshToken(): Secret {
  return secret(refreshTokenPrefix);
}

export function generateAuthorizationCode(): Secret {
  return secret("");
}

export function isRefreshTokenFormat(value: string): boolean {
  return refreshPattern.test(value);
}

export function isAuthorizationCodeFormat(value: string): boolean {
  return codePattern.test(value);
}

export function isCodeVerifierFormat(value: string): boolean {
  return verifierPattern.test(value);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isCodeVerifierFormat(verifier)) {
    return false;
  }
  const computed = Buffer.from(s256Challenge(verifier));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
