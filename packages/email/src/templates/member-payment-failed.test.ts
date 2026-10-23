import { describe, expect, it } from "vitest";

import { memberPaymentFailedEmail, memberPaymentFailedNoticeText } from "./member-payment-failed";

const base = {
  communityName: "Makers",
  amountMinor: 4900,
  currency: "usd",
  membershipUrl: "https://cohory.test/c/makers/membership",
};

describe("memberPaymentFailedEmail", () => {
  it("names the amount, the next try, and links to the membership page", () => {
    const email = memberPaymentFailedEmail({
      ...base,
      nextAttemptAt: new Date("2026-10-25T09:00:00Z"),
    });

    expect(email.subject).toBe("[Makers] Your payment failed");
    expect(email.text).toContain(
      "Your payment of $49.00 for Makers failed. We will try again on October 25, 2026. Update your card before then to keep your access.",
    );
    expect(email.text).toContain("You keep access while we try again.");
    expect(email.text).toContain("https://cohory.test/c/makers/membership");
    expect(email.html).toContain("Update payment method");
  });

  it("says access ends unless the card is updated when no retry is planned", () => {
    expect(memberPaymentFailedNoticeText({ ...base, nextAttemptAt: null })).toBe(
      "Your payment of $49.00 for Makers failed. That was the last try, so your access ends unless you update your card.",
    );
  });

  it("does not promise access on the final attempt and links the billing page", () => {
    const email = memberPaymentFailedEmail({ ...base, nextAttemptAt: null });

    expect(email.text).not.toContain("You keep access");
    expect(email.text).toContain("Update payment method: https://cohory.test/c/makers/membership");
    expect(email.html).toMatch(/Your access ends unless you update your card/);
  });

  it("never shows card details", () => {
    const email = memberPaymentFailedEmail({ ...base, nextAttemptAt: null });

    expect(`${email.subject}\n${email.text}\n${email.html}`).not.toMatch(
      /visa|mastercard|ending in|\*{4}|last four/i,
    );
  });
});
