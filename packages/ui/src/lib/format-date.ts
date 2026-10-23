export const APP_LOCALE = "en-GB";

type DateStyle = "short" | "medium" | "long" | "full";
type DateInput = Date | string | number;

interface FormatDateOptions {
  timeZone: string;
  style?: DateStyle;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  options: Intl.DateTimeFormatOptions & { timeZone: string },
): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(APP_LOCALE, options);
    formatters.set(key, cached);
  }
  return cached;
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  { timeZone, style = "medium" }: FormatDateOptions,
): string {
  return formatter({ dateStyle: style, timeZone }).format(toDate(value));
}

export function formatDateTime(
  value: DateInput,
  { timeZone, style = "medium" }: FormatDateOptions,
): string {
  return formatter({ dateStyle: style, timeStyle: "short", timeZone }).format(toDate(value));
}

export function formatDateTimeWithZone(value: DateInput, options: FormatDateOptions): string {
  return `${formatDateTime(value, options)} (${options.timeZone})`;
}
