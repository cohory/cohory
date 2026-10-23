import { stripeCurrencies } from "@cohory/payments/currency";
import { describe, expect, it } from "vitest";

import {
  currencyFractionDigits,
  formatFeeRate,
  formatMoney,
  formatMoneySpoken,
  parseMoneyInput,
  toMoneyInput,
} from "./money";

describe("formatMoney", () => {
  it("formats minor units with the currency and two decimals", () => {
    expect(formatMoney(2900, "usd", "en-US")).toBe("$29.00");
    expect(formatMoney(2900, "EUR", "en-US")).toBe("€29.00");
    expect(formatMoney(0, "usd", "en-US")).toBe("$0.00");
  });

  it("respects zero decimal currencies", () => {
    expect(currencyFractionDigits("jpy")).toBe(0);
    expect(formatMoney(500, "jpy", "en-US")).toBe("¥500");
  });

  it("reads the amount in full for screen readers", () => {
    expect(formatMoneySpoken(2900, "usd", "en-US")).toBe("29.00 US dollars");
  });
});

describe("currencyFractionDigits", () => {
  it("takes minor units from Stripe's currency table", () => {
    for (const entry of stripeCurrencies) {
      expect(currencyFractionDigits(entry.code)).toBe(entry.exponent);
      expect(parseMoneyInput("1", entry.code)).toBe(10 ** entry.exponent);
    }
  });

  it("falls back to the locale data for a currency outside the table", () => {
    expect(currencyFractionDigits("kwd")).toBe(3);
  });
});

describe("parseMoneyInput", () => {
  it("turns a typed amount into minor units", () => {
    expect(parseMoneyInput("29", "usd")).toBe(2900);
    expect(parseMoneyInput("29.5", "usd")).toBe(2950);
    expect(parseMoneyInput(" 1,290.99 ", "usd")).toBe(129099);
    expect(parseMoneyInput("500", "jpy")).toBe(500);
  });

  it("rejects amounts that are not plain numbers or have too many decimals", () => {
    expect(parseMoneyInput("", "usd")).toBeNull();
    expect(parseMoneyInput("abc", "usd")).toBeNull();
    expect(parseMoneyInput("-5", "usd")).toBeNull();
    expect(parseMoneyInput("1.999", "usd")).toBeNull();
    expect(parseMoneyInput("5.5", "jpy")).toBeNull();
  });

  it("round trips through the input format", () => {
    expect(toMoneyInput(2950, "usd")).toBe("29.50");
    expect(toMoneyInput(500, "jpy")).toBe("500");
  });
});

describe("formatFeeRate", () => {
  it("shows the rate exactly as configured", () => {
    expect(formatFeeRate(100)).toBe("1%");
    expect(formatFeeRate(200)).toBe("2%");
    expect(formatFeeRate(250)).toBe("2.5%");
    expect(formatFeeRate(5)).toBe("0.05%");
    expect(formatFeeRate(0)).toBe("0%");
  });
});
