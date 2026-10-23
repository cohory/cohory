const DAY_MS = 86_400_000;

export type CalendarView = "month" | "list";

export const listWeeks = 8;

type SearchValue = string | string[] | undefined;

function first(raw: SearchValue): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseView(raw: SearchValue): CalendarView | null {
  const value = first(raw);
  return value === "month" || value === "list" ? value : null;
}

export function parseMonth(raw: SearchValue): string | null {
  const value = first(raw);
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12) return null;
  return value ?? null;
}

export function parseEditFlag(raw: SearchValue): boolean {
  return first(raw) === "1";
}

export interface Range {
  readonly from: Date;
  readonly to: Date;
}

export function monthRange(month: string): Range {
  const [year = 1970, monthNumber = 1] = month.split("-").map(Number);
  const firstOfMonth = Date.UTC(year, monthNumber - 1, 1);
  const offsetToMonday = (new Date(firstOfMonth).getUTCDay() + 6) % 7;
  const gridStart = firstOfMonth - offsetToMonday * DAY_MS;
  return {
    from: new Date(gridStart - DAY_MS),
    to: new Date(gridStart + 43 * DAY_MS),
  };
}

export function listRange(now: Date): Range {
  return { from: now, to: new Date(now.getTime() + listWeeks * 7 * DAY_MS) };
}

export const pastDays = 60;
export const pastLimit = 10;

export function pastRange(now: Date): Range {
  return { from: new Date(now.getTime() - pastDays * DAY_MS), to: now };
}
