import { describe, expect, it } from "vitest";

import { disconnectInputSchema, isStripePortalLoginUrl } from "./schemas";

describe("isStripePortalLoginUrl", () => {
  it("accepts a billing.stripe.com login link and rejects any other host or http", () => {
    expect(isStripePortalLoginUrl("https://billing.stripe.com/p/login/test_abc")).toBe(true);
    expect(isStripePortalLoginUrl("https://billing.stripe.com.evil.test/p/login/x")).toBe(false);
    expect(isStripePortalLoginUrl("http://billing.stripe.com/p/login/x")).toBe(false);
  });

  it("rejects look alike hosts, credentials, ports, and other paths", () => {
    for (const value of [
      "https://evil.test/p/login/x?next=https://billing.stripe.com/p/login/x",
      "https://user@billing.stripe.com/p/login/x",
      "https://billing.stripe.com:8443/p/login/x",
      "https://billing.stripe.com/p/session/x",
      "https://billing.stripe.com/p/login/",
      "https://billing.stripe.com/p/login/x/../../redirect",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isStripePortalLoginUrl(value)).toBe(false);
    }
  });
});

describe("disconnectInputSchema", () => {
  it("defaults to taking members along with linked imports and no portal link", () => {
    expect(disconnectInputSchema.parse({})).toEqual({
      memberChoice: "take_members",
      includeLinked: true,
      portalLoginUrl: null,
    });
  });

  it("refuses a portal link that is not Stripe's", () => {
    expect(
      disconnectInputSchema.safeParse({ portalLoginUrl: "https://example.test/p/login/x" }).success,
    ).toBe(false);
  });
});
