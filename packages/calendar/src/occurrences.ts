import { addDays, compareDates, parseCalendarDate, parseWallClock, toInstant } from "./wall-clock";

export type Recurrence = "weekly";

export interface SeriesRule {
  readonly startsAtLocal: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly recurrence: Recurrence | null;
  readonly recurrenceUntil: string | null;
}

export interface PlannedOccurrence {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface PlanWindow {
  readonly notEndingBefore: Date;
  readonly horizon: Date;
}

export const generationWeeks = 26;
export const maxPlannedOccurrences = 120;

const weekMs = 7 * 86_400_000;

export function horizonFrom(now: Date): Date {
  return new Date(now.getTime() + generationWeeks * weekMs);
}

export function planOccurrences(rule: SeriesRule, window: PlanWindow): PlannedOccurrence[] {
  const start = parseWallClock(rule.startsAtLocal);
  if (!start) {
    throw new Error("invalid wall clock start");
  }
  const durationMs = rule.durationMinutes * 60_000;
  const occurrence = (index: number): PlannedOccurrence => {
    const startsAt = toInstant(addDays(start, index * 7), rule.timeZone);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  };
  if (rule.recurrence === null) {
    return [occurrence(0)];
  }

  const until = rule.recurrenceUntil ? parseCalendarDate(rule.recurrenceUntil) : null;
  const first = occurrence(0);
  const skip = Math.max(
    0,
    Math.floor((window.notEndingBefore.getTime() - first.endsAt.getTime()) / weekMs) - 1,
  );
  const planned: PlannedOccurrence[] = [];
  for (let index = skip; planned.length < maxPlannedOccurrences; index += 1) {
    if (until && compareDates(addDays(start, index * 7), until) > 0) {
      break;
    }
    const next = occurrence(index);
    if (next.startsAt.getTime() > window.horizon.getTime()) {
      break;
    }
    if (next.endsAt.getTime() > window.notEndingBefore.getTime()) {
      planned.push(next);
    }
  }
  return planned;
}
