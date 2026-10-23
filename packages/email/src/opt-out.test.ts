import { describe, expect, it } from "vitest";

import { hashEmailAddress } from "./log";
import { createOptOutLinker, createOptOutToken, verifyOptOutToken } from "./opt-out";

const secret = "a".repeat(32);
const communityId = "0192a1b2-0000-7000-8000-000000000001";
const claim = { addressHash: hashEmailAddress("invitee@example.com"), communityId };
const issuedAt = new Date("2026-10-22T10:00:00.000Z");

describe("community opt out tokens", () => {
  it("round trips the address hash and community", () => {
    const token = createOptOutToken(secret, claim, issuedAt);

    expect(verifyOptOutToken(secret, token, issuedAt)).toEqual(claim);
  });

  it("never carries the address itself", () => {
    const token = createOptOutToken(secret, claim, issuedAt);
    const body = Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8");

    expect(body).not.toContain("invitee");
  });

  it("rejects a token signed with another secret", () => {
    const token = createOptOutToken("b".repeat(32), claim, issuedAt);

    expect(verifyOptOutToken(secret, token, issuedAt)).toBeNull();
  });

  it("rejects a token with a changed community", () => {
    const token = createOptOutToken(secret, claim, issuedAt);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        h: claim.addressHash,
        c: "0192a1b2-0000-7000-8000-000000000009",
        i: issuedAt.getTime() / 1000,
      }),
    ).toString("base64url");

    expect(verifyOptOutToken(secret, `${forged}.${signature}`, issuedAt)).toBeNull();
  });

  it("expires after a year", () => {
    const token = createOptOutToken(secret, claim, issuedAt);
    const later = new Date(issuedAt.getTime() + 366 * 24 * 60 * 60 * 1000);

    expect(verifyOptOutToken(secret, token, later)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyOptOutToken(secret, "not-a-token", issuedAt)).toBeNull();
    expect(verifyOptOutToken(secret, "x".repeat(600), issuedAt)).toBeNull();
  });
});

describe("createOptOutLinker", () => {
  it("links the confirm page and a one click List-Unsubscribe endpoint with the same token", () => {
    const linker = createOptOutLinker({
      secret,
      appUrl: "https://cohory.example.com/",
      now: () => issuedAt,
    });

    const links = linker({ to: "invitee@example.com", communityId });

    const token = createOptOutToken(secret, claim, issuedAt);
    expect(links).toEqual({
      url: `https://cohory.example.com/email-opt-out?token=${token}`,
      headers: {
        "List-Unsubscribe": `<https://cohory.example.com/api/email-opt-out?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });
});
