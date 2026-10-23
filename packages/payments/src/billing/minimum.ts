export const defaultMinimumMinor = 500;

const minimumByCurrency: Readonly<Record<string, number>> = {
  usd: 500,
  eur: 500,
  gbp: 400,
  cad: 700,
  aud: 800,
  nzd: 900,
  chf: 500,
  sek: 5000,
  nok: 5000,
  dkk: 3500,
  pln: 2000,
  czk: 12_000,
  jpy: 750,
  sgd: 700,
  brl: 2800,
  mxn: 9000,
};

export function minimumInvoiceMinor(currency: string): number {
  return minimumByCurrency[currency.toLowerCase()] ?? defaultMinimumMinor;
}

export type BillingDecision =
  | { readonly kind: "invoice"; readonly amountMinor: number }
  | { readonly kind: "carry_forward"; readonly amountMinor: number; readonly minimumMinor: number };

export function decideBilling(currency: string, balanceMinor: number): BillingDecision {
  if (!Number.isSafeInteger(balanceMinor)) {
    throw new RangeError("balance must be an integer amount in minor units");
  }
  const minimumMinor = minimumInvoiceMinor(currency);
  return balanceMinor >= minimumMinor
    ? { kind: "invoice", amountMinor: balanceMinor }
    : { kind: "carry_forward", amountMinor: balanceMinor, minimumMinor };
}
