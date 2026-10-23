import type { DiscoveredSubscriber, LinkResult } from "@cohory/payments";
import { describe, expect, it } from "vitest";

import { initialChoices, subscribersHref, summarizeLinkResult, toLinkRow } from "./linking";

const row: DiscoveredSubscriber = {
  subscriptionId: "sub_1",
  customerId: "cus_1",
  email: "ada@example.test",
  customerName: "Ada",
  status: "active",
  priceId: "price_1",
  unitAmountMinor: 2900,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  match: { kind: "member", userId: "u-1", name: "Ada" },
  block: null,
  proposed: "link_member",
  allowed: ["link_member", "skip"],
  suggestedInterval: "month",
};

describe("subscriber linking views", () => {
  it("keeps user ids out of the client row", () => {
    expect(toLinkRow(row).match).toEqual({ kind: "member", name: "Ada" });
    expect(subscribersHref("club")).toBe("/c/club/manage/migration/subscribers");
  });

  it("pre selects the proposed action and interval and leaves blocked rows out", () => {
    expect(
      initialChoices([row, { ...row, subscriptionId: "sub_2", block: "other_platform" }]),
    ).toEqual({ sub_1: { action: "link_member", interval: "month" } });
  });

  it("summarizes outcomes and explains problems in plain words", () => {
    const result: LinkResult = {
      invitedEmails: ["b@example.test"],
      rows: [
        {
          subscriptionId: "sub_1",
          email: "a@example.test",
          outcome: "linked",
          reason: null,
          platformFeeAdded: false,
        },
        {
          subscriptionId: "sub_2",
          email: "b@example.test",
          outcome: "invited",
          reason: null,
          platformFeeAdded: false,
        },
        {
          subscriptionId: "sub_3",
          email: null,
          outcome: "refused",
          reason: "status",
          platformFeeAdded: false,
        },
        {
          subscriptionId: "sub_4",
          email: null,
          outcome: "skipped",
          reason: null,
          platformFeeAdded: false,
        },
      ],
    };
    expect(summarizeLinkResult(result, 1)).toEqual({
      linked: 1,
      invited: 1,
      skipped: 1,
      emailsSent: 1,
      problems: [{ label: "sub_3", message: "The subscription is no longer active in Stripe." }],
    });
  });
});
