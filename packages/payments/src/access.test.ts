import { describe, expect, it } from "vitest";

import { membershipSyncAction } from "./access";

describe("membershipSyncAction", () => {
  it.each([
    ["grants a new subscriber a membership", null, null, "granted", "activate"],
    [
      "reactivates a removed member who paid",
      { role: "member", status: "removed" },
      null,
      "granted",
      "activate",
    ],
    [
      "approves a pending applicant who paid",
      { role: "member", status: "pending" },
      null,
      "granted",
      "activate",
    ],
    ["keeps a past due member", { role: "member", status: "active" }, "granted", "grace", "none"],
    [
      "never reactivates a banned person",
      { role: "member", status: "banned" },
      null,
      "granted",
      "none",
    ],
    [
      "removes a member whose subscription ended",
      { role: "member", status: "active" },
      "granted",
      "revoked",
      "remove",
    ],
    [
      "removes a member whose past due subscription became unpaid",
      { role: "member", status: "active" },
      "grace",
      "revoked",
      "remove",
    ],
    [
      "leaves a member alone when a checkout never completed",
      { role: "member", status: "active" },
      null,
      "none",
      "none",
    ],
    [
      "leaves staff alone when their subscription ends",
      { role: "admin", status: "active" },
      "granted",
      "revoked",
      "none",
    ],
    [
      "keeps out a member who left while their subscription renews",
      { role: "member", status: "removed", removalReason: "left" },
      "granted",
      "granted",
      "none",
    ],
    [
      "keeps out a member who left while their subscription is past due",
      { role: "member", status: "removed", removalReason: "left" },
      "granted",
      "grace",
      "none",
    ],
    [
      "keeps out a member staff removed while their subscription renews",
      { role: "member", status: "removed", removalReason: "removed" },
      "granted",
      "granted",
      "none",
    ],
    [
      "admits a payer whose invite hold ran out before Checkout finished",
      { role: "member", status: "removed", removalReason: "hold_expired" },
      "granted",
      "granted",
      "activate",
    ],
    [
      "admits a member who left once they buy a new subscription",
      { role: "member", status: "removed", removalReason: "left" },
      null,
      "granted",
      "activate",
    ],
    [
      "readmits a member whose paid access lapsed when they pay again",
      { role: "member", status: "removed", removalReason: null },
      "revoked",
      "granted",
      "activate",
    ],
    [
      "does nothing on a repeated revocation",
      { role: "member", status: "removed" },
      "revoked",
      "revoked",
      "none",
    ],
  ] as const)("%s", (_, membership, previous, next, action) => {
    expect(membershipSyncAction({ membership, previous, next })).toBe(action);
  });

  it("removes an active member whose subscription is already stored as revoked", () => {
    expect(
      membershipSyncAction({
        membership: { role: "member", status: "active" },
        previous: "revoked",
        next: "revoked",
      }),
    ).toBe("remove");
  });

  it("keeps a member who still has access through another subscription or a comp", () => {
    expect(
      membershipSyncAction({
        membership: { role: "member", status: "active" },
        previous: "granted",
        next: "revoked",
        otherAccess: true,
      }),
    ).toBe("none");
  });
});
