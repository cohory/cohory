import { describe, expect, it } from "vitest";

import type { SubscriptionAccessFact } from "../access-summary/store";
import { summarizeMemberAccess } from "./member-access-summary";

const periodEnd = new Date("2026-11-30T00:00:00Z");

function subscription(overrides: Partial<SubscriptionAccessFact> = {}): SubscriptionAccessFact {
  return {
    userId: "u1",
    accessState: "granted",
    interval: "month",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: periodEnd,
    ...overrides,
  };
}

function summarize(
  subscriptions: SubscriptionAccessFact[],
  comps: { userId: string; expiresAt: Date | null }[] = [],
) {
  return summarizeMemberAccess({ subscriptions, comps });
}

describe("summarizeMemberAccess", () => {
  it("marks a granted monthly subscription as paying monthly until its renewal", () => {
    expect(summarize([subscription()]).get("u1")).toEqual({
      access: "paying_monthly",
      until: periodEnd,
    });
  });

  it("marks a granted yearly subscription as paying yearly", () => {
    expect(summarize([subscription({ interval: "year" })]).get("u1")?.access).toBe("paying_yearly");
  });

  it("marks a subscription set to end at period end as cancelling", () => {
    expect(summarize([subscription({ cancelAtPeriodEnd: true })]).get("u1")).toEqual({
      access: "cancelling",
      until: periodEnd,
    });
  });

  it("prefers a renewing subscription over a cancelling one for the same person", () => {
    const rows = [
      subscription({ cancelAtPeriodEnd: true }),
      subscription({ interval: "year", cancelAtPeriodEnd: false }),
    ];

    expect(summarize(rows).get("u1")?.access).toBe("paying_yearly");
  });

  it("marks a subscription in grace as past due", () => {
    expect(summarize([subscription({ accessState: "grace" })]).get("u1")?.access).toBe("past_due");
  });

  it("prefers a granted subscription over one in grace", () => {
    const rows = [subscription({ accessState: "grace" }), subscription()];

    expect(summarize(rows).get("u1")?.access).toBe("paying_monthly");
  });

  it("marks an open comp without a subscription as free access until it expires", () => {
    const expiresAt = new Date("2026-12-31T00:00:00Z");

    expect(summarize([], [{ userId: "u2", expiresAt }]).get("u2")).toEqual({
      access: "free_access",
      until: expiresAt,
    });
  });

  it("shows a paying member with a comp as paying", () => {
    const result = summarize([subscription()], [{ userId: "u1", expiresAt: null }]);

    expect(result.get("u1")?.access).toBe("paying_monthly");
  });

  it("shows a past due member with a comp as past due so the creator sees the failed payment", () => {
    const result = summarize(
      [subscription({ accessState: "grace" })],
      [{ userId: "u1", expiresAt: null }],
    );

    expect(result.get("u1")?.access).toBe("past_due");
  });

  it("leaves out people with neither a subscription nor a comp", () => {
    expect(summarize([subscription()]).has("u3")).toBe(false);
  });
});
