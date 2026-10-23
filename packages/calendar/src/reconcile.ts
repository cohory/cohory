import {
  horizonFrom,
  maxPlannedOccurrences,
  planOccurrences,
  type PlannedOccurrence,
  type SeriesRule,
} from "./occurrences";
import type { NewOccurrence, OccurrenceRecord } from "./repository";
import {
  addDays,
  compareDates,
  parseCalendarDate,
  parseWallClock,
  toInstant,
  toWallClock,
  type WallClock,
} from "./wall-clock";

export interface OccurrenceRetime {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface OccurrencePlan {
  readonly insert: readonly NewOccurrence[];
  readonly remove: readonly string[];
  readonly retime: readonly OccurrenceRetime[];
}

export interface ReconcileInput {
  readonly eventId: string;
  readonly previous: SeriesRule;
  readonly next: SeriesRule;
  readonly existing: readonly OccurrenceRecord[];
  readonly now: Date;
}

const dayMs = 86_400_000;

export function planForRule(rule: SeriesRule, now: Date) {
  return planOccurrences(rule, { notEndingBefore: now, horizon: horizonFrom(now) });
}

function startClock(rule: SeriesRule): WallClock {
  const clock = parseWallClock(rule.startsAtLocal);
  if (!clock) {
    throw new Error("invalid wall clock start");
  }
  return clock;
}

function differs(current: OccurrenceRecord, target: PlannedOccurrence): boolean {
  return (
    current.startsAt.getTime() !== target.startsAt.getTime() ||
    current.endsAt.getTime() !== target.endsAt.getTime()
  );
}

// Ended occurrences are history and stay as they are. The others, in date order, pair with the
// new schedule's dates in order, starting at the new date nearest the first of them that is not
// before today (the later one on a tie, or the new start when that is later), so each keeps its
// id, RSVPs, and links. That date counts even when its time has passed. Extra old dates are
// removed and extra new dates added.
export function reconcileOccurrences({
  eventId,
  previous,
  next,
  existing,
  now,
}: ReconcileInput): OccurrencePlan {
  const single = next.recurrence === null;
  const moveAll = single && previous.recurrence === null;
  const anchor = startClock(next);
  const until = next.recurrenceUntil ? parseCalendarDate(next.recurrenceUntil) : null;
  const durationMs = next.durationMinutes * 60_000;
  const horizon = horizonFrom(now).getTime();
  const slot = (index: number): PlannedOccurrence => {
    const startsAt = toInstant(addDays(anchor, index * 7), next.timeZone);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  };
  const inSeries = (index: number): boolean =>
    single
      ? index === 0
      : (!until || compareDates(addDays(anchor, index * 7), until) <= 0) &&
        slot(index).startsAt.getTime() <= horizon;

  const sorted = [...existing].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const isEnded = (o: OccurrenceRecord) => !moveAll && o.endsAt.getTime() <= now.getTime();
  const upcoming = sorted.filter((o) => !isEnded(o));
  const lastEnded = sorted.filter(isEnded).at(-1);

  const firstIndex = (): number => {
    if (single) {
      return 0;
    }
    const first = upcoming[0];
    if (first) {
      const today = toWallClock(now, next.timeZone);
      const target = first.startsAt.getTime();
      const guess = Math.round((target - slot(0).startsAt.getTime()) / (7 * dayMs));
      let best: number | null = null;
      for (const index of [guess - 1, guess, guess + 1, 0]) {
        if (index < 0 || compareDates(addDays(anchor, index * 7), today) < 0) {
          continue;
        }
        const distance = Math.abs(slot(index).startsAt.getTime() - target);
        const bestDistance =
          best === null ? Infinity : Math.abs(slot(best).startsAt.getTime() - target);
        if (
          distance < bestDistance ||
          (distance === bestDistance && best !== null && index > best)
        ) {
          best = index;
        }
      }
      return best ?? Math.max(0, guess);
    }
    const afterDay = lastEnded ? toWallClock(lastEnded.startsAt, previous.timeZone) : null;
    let index = 0;
    while (
      inSeries(index) &&
      (slot(index).endsAt.getTime() <= now.getTime() ||
        (afterDay !== null && compareDates(addDays(anchor, index * 7), afterDay) <= 0))
    ) {
      index += 1;
    }
    return index;
  };

  const slots: PlannedOccurrence[] = [];
  for (
    let index = firstIndex();
    inSeries(index) && slots.length < maxPlannedOccurrences;
    index += 1
  ) {
    slots.push(slot(index));
  }

  return {
    insert: slots
      .slice(upcoming.length)
      .map((occurrence) => ({ eventId, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt })),
    remove: upcoming.slice(slots.length).map((occurrence) => occurrence.id),
    retime: upcoming.slice(0, slots.length).flatMap((current, position) => {
      const target = slots[position];
      return target && differs(current, target)
        ? [{ id: current.id, startsAt: target.startsAt, endsAt: target.endsAt }]
        : [];
    }),
  };
}
