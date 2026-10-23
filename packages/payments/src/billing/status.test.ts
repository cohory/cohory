import { describe, expect, it } from "vitest";

import { displayStatus, invoiceStatusOf, suspensionDue } from "./status";

describe("platform invoice status", () => {
  it("maps Stripe invoice statuses one to one", () => {
    for (const status of ["draft", "open", "paid", "void", "uncollectible"] as const) {
      expect(invoiceStatusOf(status)).toBe(status);
    }
  });

  it("treats an unknown or missing Stripe status as draft", () => {
    expect(invoiceStatusOf(null)).toBe("draft");
    expect(invoiceStatusOf("deleted")).toBe("draft");
  });

  it("shows an open invoice with a failed payment as past due", () => {
    expect(displayStatus("open", new Date())).toBe("past_due");
    expect(displayStatus("open", null)).toBe("open");
    expect(displayStatus("paid", new Date())).toBe("paid");
  });

  it("suspends selling only after 30 full days past due", () => {
    const since = new Date("2026-10-01T00:00:00.000Z");
    expect(suspensionDue(since, new Date("2026-10-30T23:59:59.000Z"))).toBe(false);
    expect(suspensionDue(since, new Date("2026-10-31T00:00:00.000Z"))).toBe(true);
    expect(suspensionDue(null, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
  });
});
