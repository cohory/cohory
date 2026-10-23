import { describe, expect, it } from "vitest";

import {
  eligibilityMessage,
  payingMonths,
  reviewEligibility,
  reviewerStatus,
  reviewerStatusLabel,
  type TenureFacts,
} from "./eligibility";

const dayMs = 24 * 60 * 60 * 1000;
const paidSince = new Date("2026-09-01T12:00:00Z");

function tenure(overrides: Partial<TenureFacts> = {}): TenureFacts {
  return {
    providerStatus: "active",
    accessState: "granted",
    interval: "month",
    paidSince,
    ...overrides,
  };
}

function at(days: number, extraMs = 0): Date {
  return new Date(paidSince.getTime() + days * dayMs + extraMs);
}

describe("reviewEligibility", () => {
  it("refuses a paying subscriber on day 29", () => {
    expect(reviewEligibility({ membershipActive: true, tenure: tenure(), now: at(29) })).toEqual({
      eligible: false,
      reason: "too_soon",
      eligibleFrom: at(30),
    });
  });

  it("refuses one millisecond before the 30 day mark", () => {
    const result = reviewEligibility({ membershipActive: true, tenure: tenure(), now: at(30, -1) });
    expect(result.eligible).toBe(false);
  });

  it("allows a paying subscriber on day 30", () => {
    expect(reviewEligibility({ membershipActive: true, tenure: tenure(), now: at(30) })).toEqual({
      eligible: true,
      payingSince: paidSince,
    });
  });

  it("allows an annual subscriber after 30 days", () => {
    const result = reviewEligibility({
      membershipActive: true,
      tenure: tenure({ interval: "year" }),
      now: at(45),
    });
    expect(result.eligible).toBe(true);
  });

  it("refuses a trial, even a long one", () => {
    const result = reviewEligibility({
      membershipActive: true,
      tenure: tenure({ providerStatus: "trialing" }),
      now: at(90),
    });
    expect(result).toEqual({ eligible: false, reason: "trialing", eligibleFrom: null });
  });

  it("refuses a past due subscription", () => {
    const result = reviewEligibility({
      membershipActive: true,
      tenure: tenure({ providerStatus: "past_due", accessState: "grace" }),
      now: at(90),
    });
    expect(result).toEqual({ eligible: false, reason: "past_due", eligibleFrom: null });
  });

  it("refuses a comped member, who has no subscription", () => {
    const result = reviewEligibility({ membershipActive: true, tenure: null, now: at(90) });
    expect(result).toEqual({ eligible: false, reason: "no_subscription", eligibleFrom: null });
  });

  it("refuses a one time purchase", () => {
    const result = reviewEligibility({
      membershipActive: true,
      tenure: tenure({ interval: null }),
      now: at(90),
    });
    expect(result).toEqual({ eligible: false, reason: "one_time", eligibleFrom: null });
  });

  it.each(["canceled", "unpaid", "incomplete", "paused"])(
    "refuses a %s subscription",
    (providerStatus) => {
      const result = reviewEligibility({
        membershipActive: true,
        tenure: tenure({ providerStatus, accessState: "revoked" }),
        now: at(90),
      });
      expect(result).toEqual({ eligible: false, reason: "not_active", eligibleFrom: null });
    },
  );

  it("refuses someone who is not an active member, even with a subscription", () => {
    const result = reviewEligibility({ membershipActive: false, tenure: tenure(), now: at(90) });
    expect(result).toEqual({ eligible: false, reason: "not_member", eligibleFrom: null });
  });

  it("does not look at the role: owners, admins, moderators, and members follow the same rule", () => {
    const input = { membershipActive: true, tenure: tenure(), now: at(30) };
    for (const role of ["owner", "admin", "moderator", "member"]) {
      expect({ role, ...reviewEligibility(input) }).toMatchObject({ role, eligible: true });
    }
  });

  it("counts a subscription linked from the creator's Stripe like any other", () => {
    const linked: TenureFacts & { origin: string } = { ...tenure(), origin: "linked_import" };
    expect(
      reviewEligibility({ membershipActive: true, tenure: linked, now: at(30) }).eligible,
    ).toBe(true);
  });
});

describe("eligibilityMessage", () => {
  it("states the rule for anyone who is not eligible", () => {
    expect(
      eligibilityMessage({ eligible: false, reason: "no_subscription", eligibleFrom: null }),
    ).toBe("Members who have paid for at least 30 days can leave a review.");
  });

  it("names the first day when the member is close", () => {
    expect(eligibilityMessage({ eligible: false, reason: "too_soon", eligibleFrom: at(30) })).toBe(
      "Members who have paid for at least 30 days can leave a review. You can leave one from October 1, 2026.",
    );
  });

  it("returns nothing when the member is eligible", () => {
    expect(eligibilityMessage({ eligible: true, payingSince: paidSince })).toBeNull();
  });
});

describe("reviewerStatus", () => {
  it("labels an active subscriber with whole months paid", () => {
    const status = reviewerStatus(tenure(), new Date("2027-04-15T00:00:00Z"));
    expect(reviewerStatusLabel(status)).toBe("Paying member for 7 months");
  });

  it("never shows less than one month", () => {
    expect(reviewerStatusLabel(reviewerStatus(tenure(), at(31)))).toBe("Paying member for 1 month");
  });

  it("keeps a past due subscriber as paying while access lasts", () => {
    const status = reviewerStatus(
      tenure({ providerStatus: "past_due", accessState: "grace" }),
      at(70),
    );
    expect(status.kind).toBe("paying");
  });

  it.each([
    ["no subscription", null],
    ["a cancelled subscription", tenure({ providerStatus: "canceled", accessState: "revoked" })],
    ["a trial", tenure({ providerStatus: "trialing" })],
  ])("labels %s as a former member", (_label, facts) => {
    expect(reviewerStatusLabel(reviewerStatus(facts, at(60)))).toBe("Former member");
  });

  it("counts months by calendar day", () => {
    expect(payingMonths(new Date("2026-01-31T00:00:00Z"), new Date("2026-03-30T00:00:00Z"))).toBe(
      1,
    );
    expect(payingMonths(new Date("2026-01-15T00:00:00Z"), new Date("2027-01-15T00:00:00Z"))).toBe(
      12,
    );
  });
});
