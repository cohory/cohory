import { describe, expect, it } from "vitest";

import { feeClearRequiredEmail, paidMembershipChangedEmail } from "./paid-membership";

const base = {
  communityName: "Makers",
  endsAt: new Date("2026-11-18T10:00:00.000Z"),
  supportContact: "owner@example.test",
  portalLoginUrl: null,
  membershipUrl: "https://cohory.test/c/makers/membership",
};

describe("paidMembershipChangedEmail", () => {
  it("tells a member of a deleted community they are not charged again", () => {
    const email = paidMembershipChangedEmail({
      ...base,
      change: "community_deleted",
      membershipUrl: null,
    });
    expect(email.subject).toBe("[Makers] Your membership has ended");
    expect(email.text).toContain(
      "Makers has closed. We cancelled your subscription, so you will not be charged again.",
    );
    expect(email.html).not.toContain("Open your membership");
  });

  it("names the end date when an archive stops renewals", () => {
    const email = paidMembershipChangedEmail({ ...base, change: "archived_ending" });
    expect(email.text).toContain(
      "Makers is archived. Your subscription ends on November 18, 2026 and will not renew. You can read the community until then.",
    );
    expect(email.text).toContain("https://cohory.test/c/makers/membership");
  });

  it("tells members how to stop paying when billing continues", () => {
    const email = paidMembershipChangedEmail({ ...base, change: "archived_continuing" });
    expect(email.text).toContain(
      "Makers is archived. Your subscription continues and you can still read the community. To stop paying, open Manage billing on your membership page.",
    );
  });

  it("uses the fixed sentence for members billed directly by the creator", () => {
    const email = paidMembershipChangedEmail({ ...base, change: "billed_by_creator" });
    expect(email.text).toContain(
      "Your membership is now billed directly by Makers. To change or cancel it, use the link in your Stripe receipt emails or contact owner@example.test.",
    );
    expect(email.text).not.toContain("Manage your billing:");
  });

  it("adds the portal login link only when the creator gave one", () => {
    const email = paidMembershipChangedEmail({
      ...base,
      change: "billed_by_creator",
      portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
    });
    expect(email.text).toContain(
      "Manage your billing: https://billing.stripe.com/p/login/test_abc",
    );
    expect(email.html).toContain("https://billing.stripe.com/p/login/test_abc");
  });

  it("makes the creator's billing portal the main button and keeps the membership link", () => {
    const email = paidMembershipChangedEmail({
      ...base,
      change: "billed_by_creator",
      portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
      membershipUrl: "https://cohory.test/c/makers/membership",
    });
    const button = /<a href="([^"]+)"[^>]*display:inline-block/.exec(email.html);

    expect(button?.[1]).toBe("https://billing.stripe.com/p/login/test_abc");
    expect(email.text).toContain("Open your membership: https://cohory.test/c/makers/membership");
  });

  it("says the subscription will not renew when the creator winds down", () => {
    const email = paidMembershipChangedEmail({ ...base, change: "winding_down" });
    expect(email.text).toContain(
      "Makers has stopped selling memberships through Cohory. Your subscription ends on November 18, 2026 and will not renew.",
    );
  });

  it("escapes the community name in HTML", () => {
    const email = paidMembershipChangedEmail({
      ...base,
      communityName: "<b>x</b>",
      change: "archived_continuing",
    });
    expect(email.html).not.toContain("<b>x</b>");
  });
});

describe("feeClearRequiredEmail", () => {
  it("tells the owner to remove the fee in the Stripe Dashboard", () => {
    const email = feeClearRequiredEmail({
      communityName: "Makers",
      dashboardUrl: "https://dashboard.stripe.com/subscriptions",
    });
    expect(email.subject).toBe("[Makers] Remove the Cohory fee in your Stripe Dashboard");
    expect(email.text).toContain(
      "Makers is no longer connected to Cohory, so we can no longer change your subscriptions. Some of them may still carry the Cohory platform fee. Open each subscription in your Stripe Dashboard and remove the application fee. We refund any platform fee we receive after you left.",
    );
    expect(email.text).not.toContain("Stripe disconnected");
    expect(email.text).toContain("https://dashboard.stripe.com/subscriptions");
  });
});
