import { TZDate, tzOffset } from "@date-fns/tz";

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const wallClockPattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::00(?:\.0+)?)?$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseWallClock(value: string): WallClock | null {
  const match = wallClockPattern.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (!validDate(year, month, day) || hour > 23 || minute > 59) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function parseCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = datePattern.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  return validDate(year, month, day) ? { year, month, day } : null;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function formatWallClock(clock: WallClock): string {
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function addDays(clock: WallClock, days: number): WallClock {
  const date = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: clock.hour,
    minute: clock.minute,
  };
}

export function toInstant(clock: WallClock, timeZone: string): Date {
  const local = new TZDate(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    0,
    0,
    timeZone,
  );
  return new Date(local.getTime());
}

export function toWallClock(instant: Date, timeZone: string): WallClock {
  const local = new TZDate(instant.getTime(), timeZone);
  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
    hour: local.getHours(),
    minute: local.getMinutes(),
  };
}

export function offsetMinutes(timeZone: string, instant: Date): number {
  return tzOffset(timeZone, instant);
}

export function compareDates(
  clock: WallClock,
  date: { year: number; month: number; day: number },
): number {
  return (
    Date.UTC(clock.year, clock.month - 1, clock.day) - Date.UTC(date.year, date.month - 1, date.day)
  );
}

export function formatLocalTime(instant: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(instant);
  return `${formatted} (${timeZone})`;
}
