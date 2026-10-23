import { describe, expect, it } from "vitest";

import { decideBilling, defaultMinimumMinor, minimumInvoiceMinor } from "./minimum";

describe("minimum invoice amount", () => {
  it("is 5 USD", () => {
    expect(minimumInvoiceMinor("usd")).toBe(500);
    expect(minimumInvoiceMinor("USD")).toBe(500);
  });

  it("uses a fixed equivalent for other currencies, in their own minor units", () => {
    expect(minimumInvoiceMinor("jpy")).toBe(750);
    expect(minimumInvoiceMinor("sek")).toBe(5000);
  });

  it("falls back to 500 minor units for a currency without a table entry", () => {
    expect(minimumInvoiceMinor("xyz")).toBe(defaultMinimumMinor);
  });

  it("invoices a balance at exactly the minimum", () => {
    expect(decideBilling("usd", 500)).toEqual({ kind: "invoice", amountMinor: 500 });
  });

  it("carries forward a balance below the minimum", () => {
    expect(decideBilling("usd", 499)).toEqual({
      kind: "carry_forward",
      amountMinor: 499,
      minimumMinor: 500,
    });
  });

  it("carries forward a zero or negative balance after refunds", () => {
    expect(decideBilling("eur", 0).kind).toBe("carry_forward");
    expect(decideBilling("eur", -120).kind).toBe("carry_forward");
  });

  it("refuses fractional amounts", () => {
    expect(() => decideBilling("usd", 5.5)).toThrow(RangeError);
  });
});
