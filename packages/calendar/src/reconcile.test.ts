import { describe, expect, it } from "vitest";

import type { SeriesRule } from "./occurrences";
import { reconcileOccurrences } from "./reconcile";
import type { OccurrenceRecord } from "./repository";

const eventId = "0192f0a0-0000-7000-8000-00000000e001";
const rule: SeriesRule = {
  startsAtLocal: "2026-10-04T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly",
  recurrenceUntil: "2026-11-01",
};

function row(
  id: string,
  iso: string,
  minutes = 60,
  canceledAt: Date | null = null,
): OccurrenceRecord {
  const startsAt = new Date(iso);
  return {
    id,
    communityId: "0192f0a0-0000-7000-8000-00000000c001",
    eventId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + minutes * 60_000),
    canceledAt,
  };
}

const existing = [
  row("past", "2026-10-04T16:00:00Z"),
  row("a", "2026-10-11T16:00:00Z"),
  row("b", "2026-10-18T16:00:00Z"),
  row("c", "2026-10-25T17:00:00Z"),
  row("d", "2026-11-01T17:00:00Z"),
];
const now = new Date("2026-10-10T00:00:00Z");

function reconcile(next: Partial<SeriesRule>, rows = existing, at = now) {
  return reconcileOccurrences({
    eventId,
    previous: rule,
    next: { ...rule, ...next },
    existing: rows,
    now: at,
  });
}

function starts(retime: readonly { id: string; startsAt: Date }[]) {
  return [...retime]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((r) => [r.id, r.startsAt.toISOString()]);
}

describe("reconcileOccurrences", () => {
  it("changes nothing when the rule is unchanged", () => {
    expect(reconcile({})).toEqual({ insert: [], remove: [], retime: [] });
  });

  it("moves every upcoming date of a weekly series in place when the start time changes", () => {
    const plan = reconcile({ startsAtLocal: "2026-10-04T19:00" });

    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-11T17:00:00.000Z"],
      ["b", "2026-10-18T17:00:00.000Z"],
      ["c", "2026-10-25T18:00:00.000Z"],
      ["d", "2026-11-01T18:00:00.000Z"],
    ]);
    expect(plan.retime.find((r) => r.id === "a")?.endsAt.toISOString()).toBe(
      "2026-10-11T18:00:00.000Z",
    );
  });

  it("keeps the same dates and ids when the time zone changes", () => {
    const plan = reconcile({ timeZone: "America/New_York" });

    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-11T22:00:00.000Z"],
      ["b", "2026-10-18T22:00:00.000Z"],
      ["c", "2026-10-25T22:00:00.000Z"],
      ["d", "2026-11-01T23:00:00.000Z"],
    ]);
  });

  it("moves each date within its week when the weekday changes and drops only the tail", () => {
    const plan = reconcile({ startsAtLocal: "2026-10-06T18:00" });

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-13T16:00:00.000Z"],
      ["b", "2026-10-20T16:00:00.000Z"],
      ["c", "2026-10-27T17:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual(["d"]);
    expect(plan.insert).toEqual([]);
  });

  it("keeps every upcoming date when the weekday moves four days and drops only the tail", () => {
    const plan = reconcile({ startsAtLocal: "2026-10-08T18:00" });

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-15T16:00:00.000Z"],
      ["b", "2026-10-22T16:00:00.000Z"],
      ["c", "2026-10-29T17:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual(["d"]);
    expect(plan.insert).toEqual([]);
  });

  it("keeps the current week when the weekday moves one day earlier", () => {
    const plan = reconcile({ startsAtLocal: "2026-10-03T18:00" });

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-10T16:00:00.000Z"],
      ["b", "2026-10-17T16:00:00.000Z"],
      ["c", "2026-10-24T16:00:00.000Z"],
      ["d", "2026-10-31T17:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it("keeps the current week when the weekday moves three days earlier", () => {
    const plan = reconcile(
      { startsAtLocal: "2026-10-01T18:00" },
      existing,
      new Date("2026-10-07T00:00:00Z"),
    );

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-08T16:00:00.000Z"],
      ["b", "2026-10-15T16:00:00.000Z"],
      ["c", "2026-10-22T16:00:00.000Z"],
      ["d", "2026-10-29T17:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it("keeps today's date today when its new time has already passed", () => {
    const plan = reconcile(
      { startsAtLocal: "2026-10-04T16:00" },
      existing,
      new Date("2026-10-11T15:00:00Z"),
    );

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-11T14:00:00.000Z"],
      ["b", "2026-10-18T14:00:00.000Z"],
      ["c", "2026-10-25T15:00:00.000Z"],
      ["d", "2026-11-01T15:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it("changes nothing when the start moves one week earlier on the same weekday and time", () => {
    expect(reconcile({ startsAtLocal: "2026-09-27T18:00" })).toEqual({
      insert: [],
      remove: [],
      retime: [],
    });
  });

  it("moves the next date to a later new start and leaves no empty weeks", () => {
    const plan = reconcile({ startsAtLocal: "2026-10-25T18:00", recurrenceUntil: "2026-11-22" });

    expect(starts(plan.retime)).toEqual([
      ["a", "2026-10-25T17:00:00.000Z"],
      ["b", "2026-11-01T17:00:00.000Z"],
      ["c", "2026-11-08T17:00:00.000Z"],
      ["d", "2026-11-15T17:00:00.000Z"],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert.map((o) => o.startsAt.toISOString())).toEqual(["2026-11-22T17:00:00.000Z"]);
  });

  it("only changes the end when the duration changes", () => {
    const plan = reconcile({ durationMinutes: 90 });

    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(starts(plan.retime)).toEqual(
      existing.slice(1).map((o) => [o.id, o.startsAt.toISOString()]),
    );
  });

  it("drops future occurrences after a shortened end date", () => {
    const plan = reconcile({ recurrenceUntil: "2026-10-18" });

    expect(plan.remove).toEqual(["c", "d"]);
    expect(plan.insert).toEqual([]);
    expect(plan.retime).toEqual([]);
  });

  it("adds dates at the end of a series whose end date moves later", () => {
    const plan = reconcile({ recurrenceUntil: "2026-11-15" });

    expect(plan.remove).toEqual([]);
    expect(plan.retime).toEqual([]);
    expect(plan.insert.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-11-08T17:00:00.000Z",
      "2026-11-15T17:00:00.000Z",
    ]);
  });

  it("moves a canceled date instead of deleting it, so its canceled flag stays", () => {
    const rows = existing.map((o) =>
      o.id === "b" ? row("b", "2026-10-18T16:00:00Z", 60, new Date("2026-10-09T00:00:00Z")) : o,
    );

    const plan = reconcile({ startsAtLocal: "2026-10-04T19:00" }, rows);

    expect(plan.remove).toEqual([]);
    expect(plan.retime.map((r) => r.id)).toContain("b");
  });

  it("moves a date that is under way and leaves ended dates as they were", () => {
    const plan = reconcile(
      { startsAtLocal: "2026-10-04T19:00" },
      existing,
      new Date("2026-10-11T16:30:00Z"),
    );

    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.retime.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves an ended date as history and adds no second date that week", () => {
    const plan = reconcile(
      { startsAtLocal: "2026-10-04T19:00" },
      existing,
      new Date("2026-10-11T17:30:00Z"),
    );

    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(starts(plan.retime)).toEqual([
      ["b", "2026-10-18T17:00:00.000Z"],
      ["c", "2026-10-25T18:00:00.000Z"],
      ["d", "2026-11-01T18:00:00.000Z"],
    ]);
  });

  it("moves a single event in place even when its old time has passed", () => {
    const single = { recurrence: null, recurrenceUntil: null } as const;
    const plan = reconcileOccurrences({
      eventId,
      previous: { ...rule, ...single },
      next: { ...rule, ...single, startsAtLocal: "2026-10-20T10:00" },
      existing: [row("only", "2026-10-04T16:00:00Z")],
      now,
    });

    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(starts(plan.retime)).toEqual([["only", "2026-10-20T08:00:00.000Z"]]);
  });

  it("moves the next date of a series that becomes a single event and removes the rest", () => {
    const plan = reconcile({
      recurrence: null,
      recurrenceUntil: null,
      startsAtLocal: "2026-10-20T10:00",
    });

    expect(starts(plan.retime)).toEqual([["a", "2026-10-20T08:00:00.000Z"]]);
    expect(plan.remove).toEqual(["b", "c", "d"]);
    expect(plan.insert).toEqual([]);
  });

  it("moves the first date of a series that has not started into a single event", () => {
    const plan = reconcile(
      { recurrence: null, recurrenceUntil: null, startsAtLocal: "2026-10-04T19:00" },
      existing,
      new Date("2026-10-01T00:00:00Z"),
    );

    expect(starts(plan.retime)).toEqual([["past", "2026-10-04T17:00:00.000Z"]]);
    expect(plan.remove).toEqual(["a", "b", "c", "d"]);
    expect(plan.insert).toEqual([]);
  });
});
