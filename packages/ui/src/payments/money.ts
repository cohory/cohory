import { stripeCurrency } from "@cohory/payments/currency";

const defaultLocale = "en-US";

function currencyCode(currency: string): string {
  return currency.toUpperCase();
}

export function currencyFractionDigits(currency: string): number {
  return (
    stripeCurrency(currency)?.exponent ??
    new Intl.NumberFormat(defaultLocale, {
      style: "currency",
      currency: currencyCode(currency),
    }).resolvedOptions().maximumFractionDigits ??
    2
  );
}

function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyFractionDigits(currency);
}

export function formatMoney(amountMinor: number, currency: string, locale = defaultLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode(currency),
  }).format(toMajor(amountMinor, currency));
}

export function formatMoneySpoken(
  amountMinor: number,
  currency: string,
  locale = defaultLocale,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode(currency),
    currencyDisplay: "name",
  }).format(toMajor(amountMinor, currency));
}

export function parseMoneyInput(text: string, currency: string): number | null {
  const cleaned = text.trim().replaceAll(",", "");
  const digits = currencyFractionDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) {
    return null;
  }
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

export function toMoneyInput(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return toMajor(amountMinor, currency).toFixed(digits);
}

export function formatFeeRate(basisPoints: number): string {
  return `${new Intl.NumberFormat(defaultLocale, { maximumFractionDigits: 2 }).format(basisPoints / 100)}%`;
}

export type BillingInterval = "month" | "year";

export function intervalNoun(interval: BillingInterval): string {
  return interval === "year" ? "year" : "month";
}
