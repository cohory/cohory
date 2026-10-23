import { describe, expect, it } from "vitest";

import { visibleCopy } from "../test/copy";

import {
  formatMinorAmount,
  platformBillingPausedEmail,
  platformInvoicePaymentFailedEmail,
} from "./platform-billing";

const input = {
  communityName: "Clay & Co",
  periodLabel: "October 2026",
  amountMinor: 1234,
  currency: "usd",
  url: "https://invoice.stripe.com/i/test",
  billingUrl: "https://cohory.test/c/clay/manage/payments/platform-fees",
};

describe("platform billing emails", () => {
  it("formats minor units in the currency's own precision", () => {
    expect(formatMinorAmount(1234, "usd")).toBe("$12.34");
    expect(formatMinorAmount(750, "jpy")).toBe("¥750");
  });

  it("sends the invoice link and the platform fees page after a failed payment", () => {
    const email = platformInvoicePaymentFailedEmail(input);
    expect(email.subject).toBe("[Clay & Co] Payment failed for your platform fee invoice");
    expect(email.text).toContain("$12.34");
    expect(email.text).toContain(input.url);
    expect(email.text).toContain(input.billingUrl);
    expect(email.html).toContain("Clay &amp; Co");
  });

  it("names no fee rate in the billing emails", () => {
    for (const email of [
      platformInvoicePaymentFailedEmail(input),
      platformBillingPausedEmail(input),
    ]) {
      expect(email.text).not.toMatch(/\d+%/);
      expect(visibleCopy(email.html).replace(/<[^>]*>/g, "")).not.toMatch(/\d+%/);
    }
  });

  it("explains what happens after a failed payment", () => {
    const email = platformInvoicePaymentFailedEmail(input);
    expect(email.text).toContain("Existing members keep their access");
    expect(email.text).toContain("30 days");
  });

  it("tells the owner when paid signups pause and links the platform fees page", () => {
    const email = platformBillingPausedEmail(input);
    expect(email.subject).toBe("[Clay & Co] New paid signups are paused");
    expect(email.text).toContain(input.billingUrl);
  });
});
