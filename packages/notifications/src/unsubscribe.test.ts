import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createUnsubscribeToken,
  unsubscribeLinkValidityDays,
  verifyUnsubscribeToken,
} from "./unsubscribe";

const secret = "a-test-secret-that-is-at-least-32-characters";
const userId = "0192f0a0-0000-7000-8000-000000000001";

describe("unsubscribe tokens", () => {
  it("round trips the user and the scope", () => {
    const token = createUnsubscribeToken(secret, { userId, scope: "mention" });

    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId, scope: "mention" });
  });

  it("is safe to put in a URL", () => {
    const token = createUnsubscribeToken(secret, { userId, scope: "daily" });

    expect(encodeURIComponent(token)).toBe(token);
  });

  it("rejects a token signed with another secret", () => {
    const token = createUnsubscribeToken(`${secret}-other`, { userId, scope: "reply" });

    expect(verifyUnsubscribeToken(secret, token)).toBeNull();
  });

  it("rejects a token whose claim was changed", () => {
    const token = createUnsubscribeToken(secret, { userId, scope: "reply" });
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, u: "0192f0a0-0000-7000-8000-000000000002", s: "reply" }),
    ).toString("base64url");

    expect(verifyUnsubscribeToken(secret, `${forged}.${signature}`)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "abc", "a.b.c", ".", "x".repeat(600)]) {
      expect(verifyUnsubscribeToken(secret, token)).toBeNull();
    }
  });

  it("expires a year after the email was sent", () => {
    const sentAt = new Date("2026-10-19T10:00:00.000Z");
    const token = createUnsubscribeToken(secret, { userId, scope: "reply" }, sentAt);

    expect(verifyUnsubscribeToken(secret, token, new Date("2027-10-18T10:00:00.000Z"))).toEqual({
      userId,
      scope: "reply",
    });
    expect(verifyUnsubscribeToken(secret, token, new Date("2027-10-20T10:00:00.000Z"))).toBeNull();
    expect(unsubscribeLinkValidityDays).toBe(365);
  });

  it("refuses a token issued in the future, which only a forged clock could produce", () => {
    const token = createUnsubscribeToken(
      secret,
      { userId, scope: "reply" },
      new Date("2026-12-01T00:00:00.000Z"),
    );

    expect(verifyUnsubscribeToken(secret, token, new Date("2026-10-19T00:00:00.000Z"))).toBeNull();
  });

  it("treats links from before expiry existed as sent on 19 October 2026", () => {
    const body = Buffer.from(JSON.stringify({ v: 1, u: userId, s: "mention" })).toString(
      "base64url",
    );
    const token = `${body}.${signLegacy(body)}`;

    expect(verifyUnsubscribeToken(secret, token, new Date("2027-06-01T00:00:00.000Z"))).toEqual({
      userId,
      scope: "mention",
    });
    expect(verifyUnsubscribeToken(secret, token, new Date("2027-10-20T00:00:00.000Z"))).toBeNull();
  });
});

function signLegacy(body: string): string {
  const key = createHmac("sha256", secret).update("cohory.notifications.unsubscribe.v1").digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}
