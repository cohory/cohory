import { describe, expect, it } from "vitest";

import { formatMinorPlain, planPriceIssues, stripeCurrencies, stripeCurrency } from "./currency";

describe("stripeCurrency", () => {
  it("knows the exponent and minimum charge for two decimal and zero decimal currencies", () => {
    expect(stripeCurrency("usd")).toEqual({
      code: "usd",
      exponent: 2,
      minimumChargeMinor: 50,
      zeroDecimal: false,
    });
    expect(stripeCurrency("JPY")).toEqual({
      code: "jpy",
      exponent: 0,
      minimumChargeMinor: 50,
      zeroDecimal: true,
    });
    expect(stripeCurrency("gbp")?.minimumChargeMinor).toBe(30);
    expect(stripeCurrency("huf")?.minimumChargeMinor).toBe(17_500);
  });

  it("does not know currencies Stripe does not settle in", () => {
    expect(stripeCurrency("xyz")).toBeNull();
    expect(stripeCurrency("kwd")).toBeNull();
  });

  it("lists each currency once with a positive minimum", () => {
    const codes = stripeCurrencies.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(stripeCurrencies.every((entry) => entry.minimumChargeMinor > 0)).toBe(true);
  });

  it("writes a minimum in major units with the currency's own precision", () => {
    const usd = stripeCurrency("usd");
    const jpy = stripeCurrency("jpy");
    expect(usd && formatMinorPlain(50, usd)).toBe("0.50 USD");
    expect(jpy && formatMinorPlain(50, jpy)).toBe("50 JPY");
  });
});

describe("planPriceIssues", () => {
  it("accepts prices at Stripe's minimum charge", () => {
    expect(
      planPriceIssues({ currency: "usd", monthlyPriceMinor: 50, annualPriceMinor: 50 }),
    ).toEqual([]);
    expect(
      planPriceIssues({ currency: "jpy", monthlyPriceMinor: 50, annualPriceMinor: null }),
    ).toEqual([]);
  });

  it("refuses a monthly or annual price below Stripe's minimum charge for the currency", () => {
    expect(
      planPriceIssues({ currency: "usd", monthlyPriceMinor: 49, annualPriceMinor: null }),
    ).toEqual([
      {
        path: "monthlyPriceMinor",
        message: "Set a price of at least 0.50 USD. Stripe does not accept smaller charges.",
      },
    ]);
    const annual = planPriceIssues({
      currency: "czk",
      monthlyPriceMinor: 1500,
      annualPriceMinor: 1499,
    });
    expect(annual.map((issue) => issue.path)).toEqual(["annualPriceMinor"]);
  });

  it("refuses a currency outside Stripe's table", () => {
    const issues = planPriceIssues({
      currency: "xyz",
      monthlyPriceMinor: 4900,
      annualPriceMinor: null,
    });
    expect(issues.map((issue) => issue.path)).toEqual(["currency"]);
  });
});
