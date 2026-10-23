const DEFAULT_LOCALE = "en-GB";
const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
const JOIN_WINDOW_MINUTES = 15;

type WeekStart = 0 | 1;

interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  weekday: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, cached);
  }
  return cached;
}

function toDate(iso: string): Date {
  return new Date(iso);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function zonedParts(iso: string, timeZone: string): ZonedParts {
  const parts = formatter("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(toDate(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

function dateKey(iso: string, timeZone: string): string {
  const { year, month, day } = zonedParts(iso, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function monthKey(iso: string, timeZone: string): string {
  return dateKey(iso, timeZone).slice(0, 7);
}

function parseDateKey(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(key: string, days: number): string {
  return toDateKey(new Date(parseDateKey(key).getTime() + days * DAY_MS));
}

function addMonths(month: string, count: number): string {
  const [year = 1970, monthIndex = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + count, 1));
  return toDateKey(date).slice(0, 7);
}

function monthGrid(month: string, weekStartsOn: WeekStart = 1): CalendarDay[][] {
  const first = parseDateKey(`${month}-01`);
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const start = first.getTime() - offset * DAY_MS;
  const rows: CalendarDay[][] = [];
  for (let row = 0; row < 6; row++) {
    const cells: CalendarDay[] = [];
    for (let column = 0; column < 7; column++) {
      const date = new Date(start + (row * 7 + column) * DAY_MS);
      const key = toDateKey(date);
      cells.push({
        date: key,
        day: date.getUTCDate(),
        inMonth: key.startsWith(month),
        weekday: date.getUTCDay(),
      });
    }
    rows.push(cells);
  }
  return rows;
}

function weekdayLabels(
  weekStartsOn: WeekStart = 1,
  locale: string = DEFAULT_LOCALE,
): { short: string; long: string }[] {
  const sunday = Date.UTC(2026, 0, 4);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday + ((index + weekStartsOn) % 7) * DAY_MS);
    return {
      short: formatter(locale, { weekday: "short", timeZone: "UTC" }).format(date),
      long: formatter(locale, { weekday: "long", timeZone: "UTC" }).format(date),
    };
  });
}

function formatMonthLabel(month: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    parseDateKey(`${month}-01`),
  );
}

function formatDayKey(key: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateKey(key));
}

function formatDateOnly(key: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateKey(key));
}

const GMT_OFFSET = /^(?:GMT|UTC)[+-]/;

function zoneAbbreviation(timeZone: string, atISO: string, locale?: string): string {
  const candidates = [locale, "en-US", "en-GB"].filter(
    (value): value is string => typeof value === "string",
  );
  let fallback = "";
  for (const candidate of candidates) {
    const name =
      formatter(candidate, { timeZone, timeZoneName: "short" })
        .formatToParts(toDate(atISO))
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    if (!fallback) fallback = name;
    if (name && !GMT_OFFSET.test(name)) return name;
  }
  return fallback || timeZone;
}

function formatTime(iso: string, timeZone: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(toDate(iso));
}

function formatShortDate(iso: string, timeZone: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, { day: "numeric", month: "short", timeZone }).format(toDate(iso));
}

function formatTimeRange(
  startISO: string,
  endISO: string,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const startZone = zoneAbbreviation(timeZone, startISO, locale);
  const endZone = zoneAbbreviation(timeZone, endISO, locale);
  const start = formatTime(startISO, timeZone, locale);
  const end = formatTime(endISO, timeZone, locale);
  const sameDay = dateKey(startISO, timeZone) === dateKey(endISO, timeZone);
  if (sameDay && startZone === endZone) return `${start}–${end} ${startZone}`;
  const endLabel = sameDay ? end : `${formatShortDate(endISO, timeZone, locale)}, ${end}`;
  return `${start} ${startZone} – ${endLabel} ${endZone}`;
}

function formatDateLong(iso: string, timeZone: string, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(toDate(iso));
}

function dateBlockParts(iso: string, timeZone: string, locale: string = DEFAULT_LOCALE) {
  const date = toDate(iso);
  return {
    weekday: formatter(locale, { weekday: "short", timeZone }).format(date),
    day: formatter(locale, { day: "numeric", timeZone }).format(date),
    month: formatter(locale, { month: "short", timeZone }).format(date),
  };
}

function durationMinutes(startISO: string, endISO: string): number {
  return Math.max(0, Math.round((toDate(endISO).getTime() - toDate(startISO).getTime()) / MINUTE));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = hours === 1 ? "1 hour" : `${hours} hours`;
  const minuteLabel = rest === 1 ? "1 minute" : `${rest} minutes`;
  if (hours === 0) return minuteLabel;
  if (rest === 0) return hourLabel;
  return `${hourLabel} ${minuteLabel}`;
}

function formatGoingCount(count: number, locale: string = DEFAULT_LOCALE): string {
  return `${new Intl.NumberFormat(locale).format(count)} going`;
}

type OccurrencePhase = "upcoming" | "joinable" | "live" | "past";

function occurrencePhase(startISO: string, endISO: string, now: Date): OccurrencePhase {
  const time = now.getTime();
  const start = toDate(startISO).getTime();
  const end = toDate(endISO).getTime();
  if (time >= end) return "past";
  if (time >= start) return "live";
  if (time >= start - JOIN_WINDOW_MINUTES * MINUTE) return "joinable";
  return "upcoming";
}

export {
  addDays,
  addMonths,
  dateBlockParts,
  dateKey,
  DEFAULT_LOCALE,
  durationMinutes,
  formatDateLong,
  formatDateOnly,
  formatDayKey,
  formatDuration,
  formatGoingCount,
  formatMonthLabel,
  formatTime,
  formatTimeRange,
  JOIN_WINDOW_MINUTES,
  monthGrid,
  monthKey,
  occurrencePhase,
  weekdayLabels,
  zoneAbbreviation,
  zonedParts,
  type CalendarDay,
  type OccurrencePhase,
  type WeekStart,
};
