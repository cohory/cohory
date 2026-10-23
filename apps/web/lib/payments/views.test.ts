import type { MyMembershipView, PlanView } from "@cohory/payments";
import { describe, expect, it } from "vitest";

import {
  billingClosedNotice,
  checkoutReturn,
  connectSetupRequested,
  membershipPageState,
  pausedReturn,
} from "./views";

describe("pausedReturn", () => {
  it("reads a calendar date and ignores anything else", () => {
    expect(pausedReturn("2027-01-18")).toEqual(new Date("2027-01-18T00:00:00.000Z"));
    expect(pausedReturn("2027-13-45")).toBeNull();
    expect(pausedReturn("<script>")).toBeNull();
    expect(pausedReturn(["2027-01-18"])).toBeNull();
  });
});

const plan: PlanView = {
  id: "plan-1",
  name: "Membership",
  currency: "usd",
  monthlyPriceMinor: 2900,
  annualPriceMinor: null,
  purchasable: true,
  providerName: "Stripe",
  archivedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
};

const periodEnd = new Date("2026-11-03T00:00:00Z");

function mine(access: MyMembershipView["access"], canManageBilling = true): MyMembershipView {
  return {
    access,
    plan,
    subscription: null,
    canManageBilling,
    resubscribe: null,
    provider: null,
    communityArchived: false,
    canRejoin: false,
    inviteRequired: false,
    asksJoinQuestions: false,
    supportContact: null,
    price: null,
    yearly: null,
    suggestYearly: false,
    paused: false,
  };
}

describe("membershipPageState", () => {
  it("offers the plan to signed out visitors and to people who must pay", () => {
    expect(membershipPageState(plan, null)).toEqual({
      kind: "buy",
      purchasable: true,
      canManageBilling: false,
    });
    expect(membershipPageState(plan, mine({ level: "payment_required", reason: "ended" }))).toEqual(
      { kind: "buy", purchasable: true, canManageBilling: true },
    );
  });

  it("hides checkout in an invite only community from people without an invite", () => {
    const uninvited = { ...mine({ level: "not_member" }), inviteRequired: true };

    expect(membershipPageState(plan, uninvited)).toEqual({ kind: "invite_only" });
    expect(membershipPageState(plan, null, { inviteOnly: true })).toEqual({ kind: "invite_only" });
    expect(membershipPageState(plan, mine({ level: "not_member" }), { inviteOnly: true })).toEqual({
      kind: "buy",
      purchasable: true,
      canManageBilling: true,
    });
  });

  it("treats a community without a plan as free", () => {
    expect(membershipPageState(null, mine({ level: "not_member" }))).toEqual({
      kind: "free_community",
    });
  });

  it("maps grace to past due and cancel at period end to canceling", () => {
    const base = {
      level: "member",
      source: "subscription",
      currentPeriodEnd: periodEnd,
    } as const;

    expect(
      membershipPageState(plan, mine({ ...base, state: "grace", cancelAtPeriodEnd: true })),
    ).toMatchObject({ kind: "subscribed", status: "past_due", periodEnd });
    expect(
      membershipPageState(plan, mine({ ...base, state: "granted", cancelAtPeriodEnd: true })),
    ).toMatchObject({ kind: "subscribed", status: "canceling" });
    expect(
      membershipPageState(plan, mine({ ...base, state: "granted", cancelAtPeriodEnd: false })),
    ).toMatchObject({ kind: "subscribed", status: "active", canCancel: false });
  });

  it("shows the price, offers cancel, and suggests yearly only when the service says so", () => {
    const access = {
      level: "member",
      source: "subscription",
      currentPeriodEnd: periodEnd,
      state: "granted",
      cancelAtPeriodEnd: false,
    } as const;
    const price = { amountMinor: 2900, currency: "usd", interval: "month" } as const;
    const yearly = { annualPriceMinor: 29000, savingMinor: 5800, currency: "usd" };
    const priced = { ...mine(access), price, yearly };

    expect(membershipPageState(plan, priced)).toMatchObject({
      price,
      canCancel: true,
      yearlySuggestion: null,
    });
    expect(membershipPageState(plan, { ...priced, suggestYearly: true })).toMatchObject({
      yearlySuggestion: yearly,
    });
    expect(membershipPageState(plan, { ...priced, paused: true })).toMatchObject({
      status: "paused",
      canCancel: false,
    });
  });

  it("recognizes staff, banned, and free members", () => {
    expect(membershipPageState(plan, mine({ level: "staff", role: "owner" }))).toEqual({
      kind: "staff",
    });
    expect(membershipPageState(plan, mine({ level: "banned" }))).toEqual({ kind: "banned" });
    expect(membershipPageState(plan, mine({ level: "member", source: "membership" }))).toEqual({
      kind: "free_member",
    });
  });
});

describe("checkoutReturn", () => {
  it("accepts only the two return states", () => {
    expect(checkoutReturn("success")).toBe("success");
    expect(checkoutReturn("cancel")).toBe("cancel");
    expect(checkoutReturn(["success"])).toBeNull();
    expect(checkoutReturn("other")).toBeNull();
  });
});

describe("billingClosedNotice", () => {
  it("tells a member whose paid access ended how to rejoin and whom to contact", () => {
    expect(
      billingClosedNotice("Writers Room", {
        ...mine({ level: "payment_required", reason: "billing_closed" }),
        supportContact: "owner@example.test",
        price: null,
        yearly: null,
        suggestYearly: false,
        paused: false,
      }),
    ).toBe(
      "Your paid access to Writers Room ended. Join again from the community page, or contact owner@example.test.",
    );
  });

  it("leaves out the contact when there is none and stays silent for other reasons", () => {
    expect(
      billingClosedNotice(
        "Writers Room",
        mine({ level: "payment_required", reason: "billing_closed" }),
      ),
    ).toBe("Your paid access to Writers Room ended. Join again from the community page.");
    expect(
      billingClosedNotice("Writers Room", mine({ level: "payment_required", reason: "ended" })),
    ).toBeNull();
    expect(billingClosedNotice("Writers Room", null)).toBeNull();
  });
});

describe("connectSetupRequested", () => {
  it("highlights the connect step only when nothing is connected yet", () => {
    expect(connectSetupRequested("connect", null)).toBe(true);
    expect(connectSetupRequested("connect", { externalAccountId: "acct_1" })).toBe(false);
    expect(connectSetupRequested(undefined, null)).toBe(false);
    expect(connectSetupRequested(["connect"], null)).toBe(false);
  });
});
