export interface StripeCurrency {
  readonly code: string;
  readonly exponent: number;
  readonly minimumChargeMinor: number;
  readonly zeroDecimal: boolean;
}

function currency(code: string, minimumChargeMinor: number, exponent = 2): StripeCurrency {
  return { code, exponent, minimumChargeMinor, zeroDecimal: exponent === 0 };
}

// Stripe's settlement currencies with their minimum charge amounts, reviewed 2026-10-22 against
// https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts and
// https://docs.stripe.com/currencies#zero-decimal. A plan in any other currency can fail at
// renewal because its minimum depends on the exchange rate, so plans are limited to this list.
export const stripeCurrencies: readonly StripeCurrency[] = [
  currency("aed", 200),
  currency("aud", 50),
  currency("bgn", 100),
  currency("brl", 50),
  currency("cad", 50),
  currency("chf", 50),
  currency("czk", 1500),
  currency("dkk", 250),
  currency("eur", 50),
  currency("gbp", 30),
  currency("hkd", 400),
  currency("huf", 17_500),
  currency("inr", 50),
  currency("jpy", 50, 0),
  currency("mxn", 1000),
  currency("myr", 200),
  currency("nok", 300),
  currency("nzd", 50),
  currency("pln", 200),
  currency("ron", 200),
  currency("sek", 300),
  currency("sgd", 50),
  currency("thb", 1000),
  currency("usd", 50),
];

const byCode: ReadonlyMap<string, StripeCurrency> = new Map(
  stripeCurrencies.map((entry) => [entry.code, entry]),
);

export function stripeCurrency(code: string): StripeCurrency | null {
  return byCode.get(code.toLowerCase()) ?? null;
}

export function formatMinorPlain(amountMinor: number, entry: StripeCurrency): string {
  const major = amountMinor / 10 ** entry.exponent;
  return `${major.toFixed(entry.exponent)} ${entry.code.toUpperCase()}`;
}

export interface PlanPrices {
  readonly currency: string;
  readonly monthlyPriceMinor: number;
  readonly annualPriceMinor: number | null;
}

export interface PriceIssue {
  readonly path: string;
  readonly message: string;
}

export function planPriceIssues(plan: PlanPrices): PriceIssue[] {
  const entry = stripeCurrency(plan.currency);
  if (!entry) {
    return [
      {
        path: "currency",
        message: "Pick a currency from the list. Stripe cannot take payments in this one.",
      },
    ];
  }
  const minimum = `Set a price of at least ${formatMinorPlain(entry.minimumChargeMinor, entry)}. Stripe does not accept smaller charges.`;
  const prices = [
    ["monthlyPriceMinor", plan.monthlyPriceMinor],
    ["annualPriceMinor", plan.annualPriceMinor],
  ] as const;
  return prices
    .filter(([, amount]) => amount !== null && amount < entry.minimumChargeMinor)
    .map(([path]) => ({ path, message: minimum }));
}
