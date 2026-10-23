import { describe, expect, it } from "vitest";

import {
  accessEndAfterClose,
  accessStateFor,
  resolveMembershipAccess,
  type AccessInput,
  type SubscriptionSnapshot,
} from "./membership-access";

const now = new Date("2026-10-18T12:00:00.000Z");
const later = new Date("2026-11-18T12:00:00.000Z");
const earlier = new Date("2026-10-01T12:00:00.000Z");

describe("accessStateFor", () => {
  it.each([
    ["incomplete", "none"],
    ["incomplete_expired", "none"],
    ["trialing", "granted"],
    ["active", "granted"],
    ["past_due", "grace"],
    ["unpaid", "revoked"],
    ["canceled", "revoked"],
    ["paused", "revoked"],
    ["something_new", "none"],
  ] as const)("maps %s to %s", (status, state) => {
    expect(accessStateFor(status)).toBe(state);
  });
});

describe("accessStateFor a paused subscription", () => {
  it("grants access until the end of the period paid before the pause", () => {
    expect(accessStateFor("paused", later, now)).toBe("granted");
  });

  it("revokes access once that period is over, or when it is unknown", () => {
    expect(accessStateFor("paused", earlier, now)).toBe("revoked");
    expect(accessStateFor("paused", null, now)).toBe("revoked");
  });
});

describe("resolveMembershipAccess for a paused subscription", () => {
  it("keeps access through the paid period and then asks for payment", () => {
    const paused = subscription({ providerStatus: "paused", currentPeriodEnd: later });

    expect(resolveMembershipAccess(input({ subscription: paused })).level).toBe("member");
    expect(resolveMembershipAccess(input({ subscription: paused, now: later })).level).toBe(
      "payment_required",
    );
  });
});

function subscription(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    providerStatus: "active",
    accessState: "granted",
    currentPeriodEnd: later,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function input(overrides: Partial<AccessInput>): AccessInput {
  return {
    paidPlanActive: true,
    membership: null,
    subscription: null,
    comp: null,
    now,
    ...overrides,
  };
}

describe("resolveMembershipAccess", () => {
  const cases: [string, Partial<AccessInput>, string][] = [
    [
      "a banned person",
      { membership: { role: "member", status: "banned" }, subscription: subscription() },
      "banned",
    ],
    ["an owner", { membership: { role: "owner", status: "active" } }, "staff"],
    ["a moderator", { membership: { role: "moderator", status: "active" } }, "staff"],
    ["an active subscriber", { subscription: subscription() }, "member"],
    [
      "a past due subscriber",
      { subscription: subscription({ providerStatus: "past_due", accessState: "grace" }) },
      "member",
    ],
    [
      "a trialing subscriber",
      { subscription: subscription({ providerStatus: "trialing" }) },
      "member",
    ],
    [
      "a subscriber canceling at period end before the end",
      { subscription: subscription({ cancelAtPeriodEnd: true }) },
      "member",
    ],
    [
      "a subscriber canceling at period end after the end",
      { subscription: subscription({ cancelAtPeriodEnd: true, currentPeriodEnd: earlier }) },
      "payment_required",
    ],
    [
      "an unpaid subscriber",
      { subscription: subscription({ providerStatus: "unpaid", accessState: "revoked" }) },
      "payment_required",
    ],
    [
      "a canceled subscriber",
      { subscription: subscription({ providerStatus: "canceled", accessState: "revoked" }) },
      "payment_required",
    ],
    [
      "an incomplete checkout",
      { subscription: subscription({ providerStatus: "incomplete", accessState: "none" }) },
      "payment_required",
    ],
    [
      "an expired checkout",
      { subscription: subscription({ providerStatus: "incomplete_expired", accessState: "none" }) },
      "payment_required",
    ],
    ["a visitor of a paid community", {}, "payment_required"],
    ["a person with open ended comped access", { comp: { expiresAt: null } }, "member"],
    ["a person with comped access until later", { comp: { expiresAt: later } }, "member"],
    ["a person whose comped access expired", { comp: { expiresAt: earlier } }, "payment_required"],
    [
      "a banned person with comped access",
      { membership: { role: "member", status: "banned" }, comp: { expiresAt: null } },
      "banned",
    ],
    [
      "a comped member without a subscription",
      { membership: { role: "member", status: "active" } },
      "member",
    ],
    [
      "a removed member of a paid community",
      { membership: { role: "member", status: "removed" } },
      "payment_required",
    ],
    ["a visitor of a free community", { paidPlanActive: false }, "not_member"],
    [
      "a member of a free community",
      { paidPlanActive: false, membership: { role: "member", status: "active" } },
      "member",
    ],
    [
      "a subscriber after the plan was archived",
      { paidPlanActive: false, subscription: subscription() },
      "member",
    ],
  ];

  it.each(cases)("gives %s the %s level", (_, overrides, level) => {
    expect(resolveMembershipAccess(input(overrides)).level).toBe(level);
  });

  it("names comped access as the source when there is no paying subscription", () => {
    expect(resolveMembershipAccess(input({ comp: { expiresAt: later } }))).toEqual({
      level: "member",
      source: "comp",
      expiresAt: later,
    });
    expect(
      resolveMembershipAccess(input({ comp: { expiresAt: null }, subscription: subscription() })),
    ).toMatchObject({ level: "member", source: "subscription" });
  });

  it("reports the grace state so the member sees the update payment banner", () => {
    const access = resolveMembershipAccess(
      input({ subscription: subscription({ providerStatus: "past_due", accessState: "grace" }) }),
    );
    expect(access).toMatchObject({ level: "member", source: "subscription", state: "grace" });
  });

  it("says why payment is required", () => {
    expect(
      resolveMembershipAccess(input({})).level === "payment_required" &&
        resolveMembershipAccess(input({})),
    ).toMatchObject({
      reason: "no_subscription",
    });
    expect(
      resolveMembershipAccess(
        input({
          subscription: subscription({ providerStatus: "incomplete", accessState: "none" }),
        }),
      ),
    ).toMatchObject({ reason: "incomplete" });
    expect(
      resolveMembershipAccess(
        input({
          subscription: subscription({ providerStatus: "canceled", accessState: "revoked" }),
        }),
      ),
    ).toMatchObject({ reason: "ended" });
  });
});

describe("after the creator disconnected", () => {
  const may1 = new Date("2026-05-01T00:00:00.000Z");
  const may31 = new Date("2026-05-31T00:00:00.000Z");
  const june = new Date("2026-06-02T00:00:00.000Z");
  const mid = new Date("2026-05-15T00:00:00.000Z");
  const member = { role: "member", status: "active" } as const;

  it("grants until the stored period end after the connection closed", () => {
    expect(accessEndAfterClose({ accessState: "granted", currentPeriodEnd: may31 }, may1)).toEqual(
      may31,
    );
    expect(accessEndAfterClose({ accessState: "granted", currentPeriodEnd: null }, may1)).toEqual(
      may1,
    );
    expect(
      accessEndAfterClose({ accessState: "revoked", currentPeriodEnd: may31 }, may1),
    ).toBeNull();
    expect(accessEndAfterClose({ accessState: "none", currentPeriodEnd: may31 }, may1)).toBeNull();
  });

  it("never ends access before the connection closed", () => {
    expect(
      accessEndAfterClose(
        { accessState: "granted", currentPeriodEnd: new Date("2026-04-20T00:00:00.000Z") },
        may1,
      ),
    ).toEqual(may1);
  });

  it("keeps a member until the period end and then asks them to pay", () => {
    const closed = subscription({ currentPeriodEnd: may31, connectionClosedAt: may1 });

    expect(
      resolveMembershipAccess(input({ membership: member, subscription: closed, now: mid })),
    ).toMatchObject({ level: "member", source: "subscription", currentPeriodEnd: may31 });
    expect(
      resolveMembershipAccess(
        input({ membership: member, subscription: closed, now: june, paidPlanActive: false }),
      ),
    ).toEqual({ level: "payment_required", reason: "billing_closed" });
  });

  it("ends a past due subscription at its period end after close", () => {
    const grace = subscription({
      providerStatus: "past_due",
      accessState: "grace",
      currentPeriodEnd: may31,
      connectionClosedAt: may1,
    });

    expect(
      resolveMembershipAccess(input({ membership: member, subscription: grace, now: mid })).level,
    ).toBe("member");
    expect(
      resolveMembershipAccess(input({ membership: member, subscription: grace, now: june })),
    ).toEqual({ level: "payment_required", reason: "billing_closed" });
  });

  it("resolves billing_closed for a member after the end and keeps staff", () => {
    const closed = subscription({ currentPeriodEnd: may31, connectionClosedAt: may1 });
    const swept = subscription({
      accessState: "revoked",
      currentPeriodEnd: may31,
      connectionClosedAt: may1,
    });

    expect(
      resolveMembershipAccess(input({ membership: null, subscription: swept, now: june })),
    ).toEqual({ level: "payment_required", reason: "billing_closed" });
    expect(
      resolveMembershipAccess(
        input({ membership: { role: "admin", status: "active" }, subscription: closed, now: june }),
      ),
    ).toEqual({ level: "staff", role: "admin" });
  });

  it("keeps access for a member with an open comp", () => {
    const closed = subscription({ currentPeriodEnd: may31, connectionClosedAt: may1 });

    expect(
      resolveMembershipAccess(
        input({ membership: member, subscription: closed, comp: { expiresAt: null }, now: june }),
      ),
    ).toEqual({ level: "member", source: "comp", expiresAt: null });
  });

  it("leaves a subscription that ended before the close as it was", () => {
    const canceled = subscription({
      providerStatus: "canceled",
      accessState: "revoked",
      currentPeriodEnd: may31,
      connectionClosedAt: may1,
    });

    expect(
      resolveMembershipAccess(input({ membership: null, subscription: canceled, now: june })),
    ).toEqual({ level: "payment_required", reason: "ended" });
  });
});
