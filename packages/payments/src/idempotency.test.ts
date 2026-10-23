import { describe, expect, it } from "vitest";

import { requestKey } from "./idempotency";

describe("requestKey", () => {
  it("keeps the readable base and returns the same key for the same parameters", () => {
    const first = requestKey("portal:conn:cus:membership:1", { returnUrl: "https://a.test/x" });
    const again = requestKey("portal:conn:cus:membership:1", { returnUrl: "https://a.test/x" });

    expect(first).toMatch(/^portal:conn:cus:membership:1:[0-9a-f]{16}$/);
    expect(again).toBe(first);
  });

  it("returns a different key when any parameter differs", () => {
    const base = "checkout:plan:user:month:1";
    const keys = new Set([
      requestKey(base, { priceId: "price_a", customerId: null, trialEnd: null }),
      requestKey(base, { priceId: "price_b", customerId: null, trialEnd: null }),
      requestKey(base, { priceId: "price_a", customerId: "cus_1", trialEnd: null }),
      requestKey(base, { priceId: "price_a", customerId: null, trialEnd: new Date(0) }),
    ]);

    expect(keys.size).toBe(4);
  });
});
