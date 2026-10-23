import { describe, expect, it } from "vitest";

import { communityAccessFrom, noCommunityAccess } from "./community-access";
import type { AccessInput, SubscriptionSnapshot } from "./membership-access";

const now = new Date("2026-10-22T12:00:00.000Z");
const later = new Date("2026-11-22T12:00:00.000Z");
const earlier = new Date("2026-10-01T12:00:00.000Z");

const activeMember = { role: "member", status: "active" } as const;

function subscription(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    providerStatus: "active",
    accessState: "granted",
    currentPeriodEnd: later,
    cancelAtPeriodEnd: false,
    connectionClosedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    paidPlanActive: true,
    membership: activeMember,
    subscription: null,
    comp: null,
    now,
    ...overrides,
  };
}

describe("communityAccessFrom", () => {
  it("entitles an active member of a free community", () => {
    expect(communityAccessFrom(input({ paidPlanActive: false }))).toEqual({
      role: "member",
      entitled: true,
    });
  });

  it("entitles a member whose subscription grants access", () => {
    expect(communityAccessFrom(input({ subscription: subscription() })).entitled).toBe(true);
  });

  it("keeps a past due member entitled during grace", () => {
    const pastDue = subscription({ providerStatus: "past_due", accessState: "grace" });
    expect(communityAccessFrom(input({ subscription: pastDue })).entitled).toBe(true);
  });

  it("keeps a member who cancelled at period end entitled until the period ends", () => {
    const cancelling = subscription({ cancelAtPeriodEnd: true });
    expect(communityAccessFrom(input({ subscription: cancelling })).entitled).toBe(true);
  });

  it("entitles a member with an open comp and no subscription", () => {
    expect(communityAccessFrom(input({ comp: { expiresAt: later } })).entitled).toBe(true);
  });

  it("denies a member whose billing closed and whose paid access has ended", () => {
    const closed = subscription({ currentPeriodEnd: earlier, connectionClosedAt: earlier });
    expect(communityAccessFrom(input({ subscription: closed }))).toEqual({
      role: "member",
      entitled: false,
    });
  });

  it("keeps a member entitled after billing closed while a comp is open", () => {
    const closed = subscription({ currentPeriodEnd: earlier, connectionClosedAt: earlier });
    const access = communityAccessFrom(input({ subscription: closed, comp: { expiresAt: null } }));
    expect(access.entitled).toBe(true);
  });

  it("keeps staff entitled after billing closed", () => {
    const closed = subscription({ currentPeriodEnd: earlier, connectionClosedAt: earlier });
    const staff = { role: "admin", status: "active" } as const;
    expect(communityAccessFrom(input({ membership: staff, subscription: closed }))).toEqual({
      role: "admin",
      entitled: true,
    });
  });

  it.each(["removed", "banned", "pending"] as const)(
    "gives no role and no entitlement to a %s membership even with a granting subscription",
    (status) => {
      const access = communityAccessFrom(
        input({ membership: { role: "member", status }, subscription: subscription() }),
      );
      expect(access).toEqual(noCommunityAccess);
    },
  );

  it("gives no role and no entitlement without a membership", () => {
    expect(communityAccessFrom(input({ membership: null, comp: { expiresAt: null } }))).toEqual(
      noCommunityAccess,
    );
  });
});
