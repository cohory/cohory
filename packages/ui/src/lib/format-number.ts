import { APP_LOCALE } from "./format-date";

const counts = new Intl.NumberFormat(APP_LOCALE);

export function formatCount(value: number): string {
  return counts.format(value);
}
