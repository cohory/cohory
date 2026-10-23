import type { z } from "zod";

import { CalendarValidationError } from "../errors";
import type { SeriesRule } from "../occurrences";
import { reconcileOccurrences, type OccurrencePlan } from "../reconcile";
import type { EventRecord, GoingUser } from "../repository";
import { ruleIssues, type updateEventInputSchema } from "../schemas";
import type { Access } from "./context";

export type EventPatchInput = z.output<typeof updateEventInputSchema>;

export interface ScheduleChange {
  readonly previous: SeriesRule;
  readonly rule: SeriesRule;
  readonly plan: OccurrencePlan;
  readonly moves: readonly Baseline[];
  readonly baseline: readonly Baseline[];
}

interface Baseline {
  readonly occurrenceId: string;
  readonly previousStart: Date;
}

export function ruleOf(event: EventRecord): SeriesRule {
  return {
    startsAtLocal: event.startsAtLocal,
    timeZone: event.timeZone,
    durationMinutes: event.durationMinutes,
    recurrence: event.recurrence === "weekly" ? "weekly" : null,
    recurrenceUntil: event.recurrenceUntil,
  };
}

export function checkRule(rule: SeriesRule): void {
  const issues = ruleIssues(rule);
  if (issues.length > 0) {
    throw new CalendarValidationError(issues);
  }
}

function nextRule(current: EventRecord, patch: EventPatchInput): SeriesRule {
  const recurrence = patch.recurrence === undefined ? ruleOf(current).recurrence : patch.recurrence;
  return {
    startsAtLocal: patch.startsAtLocal ?? current.startsAtLocal,
    timeZone: patch.timeZone ?? current.timeZone,
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    recurrence,
    recurrenceUntil:
      recurrence === null
        ? null
        : patch.recurrenceUntil === undefined
          ? current.recurrenceUntil
          : patch.recurrenceUntil,
  };
}

export async function planScheduleChange(
  access: Access,
  current: EventRecord,
  patch: EventPatchInput,
  now: Date,
): Promise<ScheduleChange> {
  const previous = ruleOf(current);
  const rule = nextRule(current, patch);
  checkRule(rule);
  const existing = await access.store.listEventOccurrences(current.id);
  const plan = reconcileOccurrences({ eventId: current.id, previous, next: rule, existing, now });
  const previousStarts = new Map(existing.map((o) => [o.id, o.startsAt]));
  const moves = plan.retime
    .flatMap((o) => {
      const previousStart = previousStarts.get(o.id);
      return previousStart && previousStart.getTime() !== o.startsAt.getTime()
        ? [{ occurrenceId: o.id, previousStart }]
        : [];
    })
    .sort((a, b) => a.previousStart.getTime() - b.previousStart.getTime());
  const removed = new Set(plan.remove);
  const movedIds = new Set(moves.map((move) => move.occurrenceId));
  const baseline = existing
    .filter((o) => !removed.has(o.id) && (o.endsAt.getTime() > now.getTime() || movedIds.has(o.id)))
    .map((o) => ({ occurrenceId: o.id, previousStart: o.startsAt }));
  return { previous, rule, plan, moves, baseline };
}

export function countPeople(rows: readonly GoingUser[], except: string | null): number {
  return new Set(rows.map((row) => row.userId).filter((userId) => userId !== except)).size;
}

export function removalsOf(rows: readonly GoingUser[], except: string | null) {
  const byUser = new Map<string, { starts: string[]; occurrenceIds: string[] }>();
  for (const { userId, startsAt, occurrenceId } of rows) {
    if (userId !== except) {
      const entry = byUser.get(userId) ?? { starts: [], occurrenceIds: [] };
      entry.starts.push(startsAt.toISOString());
      entry.occurrenceIds.push(occurrenceId);
      byUser.set(userId, entry);
    }
  }
  return [...byUser].map(([userId, entry]) => ({ userId, ...entry }));
}
