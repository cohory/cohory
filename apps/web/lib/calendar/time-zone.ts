export const timeZoneCookie = "tz";
export const timeZoneCookieMaxAge = 60 * 60 * 24 * 365;
export const fallbackTimeZone = "UTC";

const ianaName = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  if (!ianaName.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveViewerTimeZone(
  cookieValue: string | null | undefined,
  eventTimeZone?: string | null,
): string {
  const fromCookie = cookieValue ? decode(cookieValue) : null;
  if (isTimeZone(fromCookie)) return fromCookie;
  if (isTimeZone(eventTimeZone)) return eventTimeZone;
  return fallbackTimeZone;
}
