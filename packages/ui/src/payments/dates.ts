export function formatBillingDate(date: Date, locale = "en-US", timeZone = "UTC"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(date);
}
