import { describe, expect, it } from "vitest";

import { noticeIdFor, subscriptionChanges, type SubscriptionFacts } from "./member-notices";

const active: SubscriptionFacts = {
  accessState: "granted",
  cancelAtPeriodEnd: false,
  origin: "created_by_cohory",
};

describe("subscriptionChanges", () => {
  it("reports a new paying member when a subscription starts granting access", () => {
    expect(subscriptionChanges(null, active)).toEqual(["joined"]);
    expect(subscriptionChanges({ ...active, accessState: "revoked" }, active)).toEqual(["joined"]);
  });

  it("does not report members whose subscription was linked from before Cohory", () => {
    expect(subscriptionChanges(null, { ...active, origin: "linked_import" })).toEqual([]);
  });

  it("reports a cancellation once, when the subscription is set to end at the period end", () => {
    const ending = { ...active, cancelAtPeriodEnd: true };
    expect(subscriptionChanges(active, ending)).toEqual(["canceled"]);
    expect(subscriptionChanges(ending, ending)).toEqual([]);
    expect(subscriptionChanges(ending, { ...ending, accessState: "revoked" })).toEqual([]);
  });

  it("reports nothing for a renewal or a past due subscription", () => {
    expect(subscriptionChanges(active, active)).toEqual([]);
    expect(subscriptionChanges(active, { ...active, accessState: "grace" })).toEqual([]);
  });
});

describe("noticeIdFor", () => {
  it("is a stable uuid for the same key and differs for another key", () => {
    const id = noticeIdFor("payment_failed:in_1:1");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(noticeIdFor("payment_failed:in_1:1")).toBe(id);
    expect(noticeIdFor("payment_failed:in_1:2")).not.toBe(id);
  });
});
