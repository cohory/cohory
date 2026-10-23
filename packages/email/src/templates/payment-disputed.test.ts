import { describe, expect, it } from "vitest";

import { paymentDisputedEmail, paymentDisputedNoticeText } from "./payment-disputed";

describe("paymentDisputedEmail", () => {
  it("tells the owner the amount, where to answer, and that access stays on", () => {
    const email = paymentDisputedEmail({
      communityName: "Makers",
      amountMinor: 4900,
      currency: "usd",
      dashboardUrl: "https://dashboard.stripe.com/disputes",
    });

    expect(email.subject).toBe("[Makers] A member disputed a payment of $49.00");
    expect(email.text).toContain(
      "A member disputed a payment of $49.00 in Makers. Answer it in your Stripe Dashboard before the deadline Stripe shows. The member keeps access while the dispute is open.",
    );
    expect(email.text).toContain("https://dashboard.stripe.com/disputes");
    expect(email.html).toContain("Open your disputes in Stripe");
  });

  it("formats zero decimal currencies without minor digits", () => {
    expect(
      paymentDisputedNoticeText({ communityName: "Makers", amountMinor: 4900, currency: "jpy" }),
    ).toContain("¥4,900");
  });
});
