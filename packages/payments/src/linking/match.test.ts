import { describe, expect, it } from "vitest";

import type { GatewaySubscriptionSummary } from "../gateway";
import { previewSubscriber, suggestInterval, type MatchContext } from "./match";

function summary(overrides: Partial<GatewaySubscriptionSummary> = {}): GatewaySubscriptionSummary {
  return {
    id: "sub_1",
    status: "active",
    customerId: "cus_1",
    customerEmail: "Ada@Example.test",
    customerName: "Ada",
    priceId: "price_old",
    unitAmountMinor: 2900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    createdByApplication: null,
    metadata: {},
    applicationFeePercent: null,
    ...overrides,
  };
}

const ada = { userId: "u-ada", name: "Ada", emailVerified: true, membership: null };

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    communityId: "c-1",
    usersByEmail: new Map(),
    mirrored: new Set(),
    invited: new Set(),
    customerOwners: new Map(),
    bannedEmails: new Set(),
    ownApplicationId: null,
    matchOutsiders: true,
    plan: { monthlyPriceId: "price_month", annualPriceId: "price_year" },
    ...overrides,
  };
}

describe("previewSubscriber", () => {
  it("links to an active member with a verified email, matching case insensitively", () => {
    const preview = previewSubscriber(
      summary(),
      context({
        usersByEmail: new Map([
          ["ada@example.test", { ...ada, membership: { role: "member", status: "active" } }],
        ]),
      }),
    );
    expect(preview.match).toEqual({ kind: "member", userId: "u-ada", name: "Ada" });
    expect(preview.proposed).toBe("link_member");
    expect(preview.allowed).toEqual(["link_member", "skip"]);
    expect(preview.block).toBeNull();
  });

  it("links and adds a membership for a verified account that is not an active member", () => {
    for (const membership of [
      null,
      { role: "member", status: "removed" },
      { role: "member", status: "pending" },
    ] as const) {
      const preview = previewSubscriber(
        summary(),
        context({ usersByEmail: new Map([["ada@example.test", { ...ada, membership }]]) }),
      );
      expect(preview.match).toEqual({ kind: "user", userId: "u-ada", name: "Ada" });
      expect(preview.proposed).toBe("link_and_add");
      expect(preview.allowed).toEqual(["link_and_add", "skip"]);
    }
  });

  it("shows accounts outside the community as unknown addresses when outsiders stay hidden", () => {
    for (const candidate of [
      { ...ada, membership: null },
      { ...ada, emailVerified: false, membership: null },
      { ...ada, membership: { role: "member", status: "removed" } },
      { ...ada, membership: { role: "member", status: "pending" } },
    ] as const) {
      const preview = previewSubscriber(
        summary(),
        context({
          matchOutsiders: false,
          usersByEmail: new Map([["ada@example.test", candidate]]),
        }),
      );
      expect(preview).toEqual(previewSubscriber(summary(), context({ matchOutsiders: false })));
    }
    const member = previewSubscriber(
      summary(),
      context({
        matchOutsiders: false,
        usersByEmail: new Map([
          ["ada@example.test", { ...ada, membership: { role: "member", status: "active" } }],
        ]),
      }),
    );
    expect(member.match).toEqual({ kind: "member", userId: "u-ada", name: "Ada" });
    const banned = previewSubscriber(
      summary(),
      context({
        matchOutsiders: false,
        usersByEmail: new Map([
          ["ada@example.test", { ...ada, membership: { role: "member", status: "banned" } }],
        ]),
      }),
    );
    expect(banned.block).toBe("banned");
  });

  it("blocks an address banned in the community whoever holds it now", () => {
    const outsider = previewSubscriber(
      summary({ customerEmail: "Ada@Example.test" }),
      context({
        usersByEmail: new Map([["ada@example.test", ada]]),
        bannedEmails: new Set(["ada@example.test"]),
      }),
    );
    expect(outsider.block).toBe("banned");
    expect(outsider.allowed).toEqual(["skip"]);

    const unknown = previewSubscriber(
      summary(),
      context({ bannedEmails: new Set(["ada@example.test"]) }),
    );
    expect(unknown.block).toBe("banned");
  });

  it("invites by email when nobody matches or the matching account never verified its email", () => {
    const nobody = previewSubscriber(summary(), context());
    expect(nobody.match).toEqual({ kind: "none" });
    expect(nobody.proposed).toBe("invite");
    expect(nobody.allowed).toEqual(["invite", "skip"]);

    const unverified = previewSubscriber(
      summary(),
      context({
        usersByEmail: new Map([
          [
            "ada@example.test",
            { ...ada, emailVerified: false, membership: { role: "member", status: "active" } },
          ],
        ]),
      }),
    );
    expect(unverified.match).toEqual({ kind: "unverified" });
    expect(unverified.proposed).toBe("invite");
  });

  it("only allows skip for blocked rows", () => {
    const cases: [Partial<GatewaySubscriptionSummary>, Partial<MatchContext>, string][] = [
      [{}, { mirrored: new Set(["sub_1"]) }, "already_linked"],
      [{ metadata: { cohory_community_id: "c-1" } }, {}, "already_linked"],
      [{}, { invited: new Set(["sub_1"]) }, "invited"],
      [{ createdByApplication: "ca_other" }, {}, "other_platform"],
      [{ customerEmail: "  " }, {}, "no_email"],
      [{ customerEmail: null }, {}, "no_email"],
      [
        {},
        {
          usersByEmail: new Map([
            ["ada@example.test", { ...ada, membership: { role: "member", status: "banned" } }],
          ]),
        },
        "banned",
      ],
      [
        {},
        {
          usersByEmail: new Map([["ada@example.test", ada]]),
          customerOwners: new Map([["cus_1", "u-someone-else"]]),
        },
        "customer_conflict",
      ],
    ];
    for (const [overrides, ctx, block] of cases) {
      const preview = previewSubscriber(summary(overrides), context(ctx));
      expect(preview.block).toBe(block);
      expect(preview.proposed).toBe("skip");
      expect(preview.allowed).toEqual(["skip"]);
    }
  });

  it("accepts subscriptions that this platform's own Connect application created", () => {
    const own = previewSubscriber(
      summary({ createdByApplication: "ca_cohory" }),
      context({ ownApplicationId: "ca_cohory" }),
    );
    expect(own.block).toBeNull();
    const other = previewSubscriber(
      summary({ createdByApplication: "ca_other" }),
      context({ ownApplicationId: "ca_cohory" }),
    );
    expect(other.block).toBe("other_platform");
  });

  it("accepts a customer that is already bound to the matched person", () => {
    const preview = previewSubscriber(
      summary(),
      context({
        usersByEmail: new Map([["ada@example.test", ada]]),
        customerOwners: new Map([["cus_1", "u-ada"]]),
      }),
    );
    expect(preview.block).toBeNull();
    expect(preview.proposed).toBe("link_and_add");
  });

  it("refuses a customer bound to someone when the email matches nobody", () => {
    const preview = previewSubscriber(
      summary(),
      context({ customerOwners: new Map([["cus_1", "u-someone"]]) }),
    );
    expect(preview.block).toBe("customer_conflict");
  });
});

describe("suggestInterval", () => {
  const plan = { monthlyPriceId: "price_month", annualPriceId: "price_year" };

  it("uses the plan price when the subscription is on it", () => {
    expect(suggestInterval(summary({ priceId: "price_year", interval: "month" }), plan)).toBe(
      "year",
    );
    expect(suggestInterval(summary({ priceId: "price_month", interval: "year" }), plan)).toBe(
      "month",
    );
  });

  it("falls back to the Stripe interval for one month or one year", () => {
    expect(suggestInterval(summary({ interval: "month" }), plan)).toBe("month");
    expect(suggestInterval(summary({ interval: "year" }), null)).toBe("year");
  });

  it("asks the creator for any other billing period", () => {
    expect(suggestInterval(summary({ interval: "week" }), plan)).toBeNull();
    expect(suggestInterval(summary({ interval: "month", intervalCount: 3 }), plan)).toBeNull();
    expect(suggestInterval(summary({ interval: null }), plan)).toBeNull();
  });
});
