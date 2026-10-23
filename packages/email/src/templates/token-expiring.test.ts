import { describe, expect, it } from "vitest";

import { tokenExpiringEmail } from "./token-expiring";

describe("tokenExpiringEmail", () => {
  const input = {
    communityName: "Makers",
    tokenName: "Nightly sync",
    agentName: null,
    expiresAt: new Date("2026-10-29T09:00:00.000Z"),
    now: new Date("2026-10-22T09:00:00.000Z"),
    url: "https://cohory.test/account/api-tokens",
  };

  it("names the token, the day it stops, and where to regenerate it", () => {
    const email = tokenExpiringEmail(input);
    expect(email.subject).toBe("[Makers] Your token Nightly sync expires in 7 days");
    expect(email.text).toContain("October 29, 2026");
    expect(email.text).toContain("Regenerate");
    expect(email.text).toContain("https://cohory.test/account/api-tokens");
    expect(email.html).toContain("Open your tokens");
  });

  it("names the agent for an agent token", () => {
    const email = tokenExpiringEmail({ ...input, agentName: "Digest bot" });
    expect(email.text).toContain("Digest bot");
  });

  it("escapes names in HTML", () => {
    const email = tokenExpiringEmail({ ...input, tokenName: "<b>x</b>" });
    expect(email.html).not.toContain("<b>x</b>");
  });

  it("counts the days left instead of assuming 7", () => {
    expect(
      tokenExpiringEmail({ ...input, now: new Date("2026-10-24T09:00:00.000Z") }).subject,
    ).toBe("[Makers] Your token Nightly sync expires in 5 days");
    expect(
      tokenExpiringEmail({ ...input, now: new Date("2026-10-28T12:00:00.000Z") }).subject,
    ).toBe("[Makers] Your token Nightly sync expires within a day");
    expect(
      tokenExpiringEmail({ ...input, now: new Date("2026-10-27T09:00:00.000Z") }).subject,
    ).toBe("[Makers] Your token Nightly sync expires in 2 days");
  });
});
