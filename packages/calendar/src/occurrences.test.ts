import { describe, expect, it } from "vitest";

import { planOccurrences, type SeriesRule } from "./occurrences";
import { isValidTimeZone, parseWallClock, toWallClock } from "./wall-clock";

const weeklyBerlin: SeriesRule = {
  startsAtLocal: "2026-10-18T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly",
  recurrenceUntil: "2026-11-08",
};

describe("planOccurrences", () => {
  it("keeps a weekly 18:00 Europe/Berlin call at 18:00 local across the October change", () => {
    const planned = planOccurrences(weeklyBerlin, {
      notEndingBefore: new Date("2026-10-01T00:00:00Z"),
      horizon: new Date("2027-01-01T00:00:00Z"),
    });

    expect(planned.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-10-18T16:00:00.000Z",
      "2026-10-25T17:00:00.000Z",
      "2026-11-01T17:00:00.000Z",
      "2026-11-08T17:00:00.000Z",
    ]);
    expect(planned.map((o) => toWallClock(o.startsAt, "Europe/Berlin").hour)).toEqual([
      18, 18, 18, 18,
    ]);
    expect(planned[0]?.endsAt.toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });

  it("shows the same instants at shifting local hours for a member in New York", () => {
    const planned = planOccurrences(weeklyBerlin, {
      notEndingBefore: new Date("2026-10-01T00:00:00Z"),
      horizon: new Date("2027-01-01T00:00:00Z"),
    });

    expect(planned.map((o) => toWallClock(o.startsAt, "America/New_York").hour)).toEqual([
      12, 13, 12, 12,
    ]);
  });

  it("returns one occurrence for a single event even when it has ended", () => {
    const planned = planOccurrences(
      { ...weeklyBerlin, recurrence: null, recurrenceUntil: null },
      {
        notEndingBefore: new Date("2027-01-01T00:00:00Z"),
        horizon: new Date("2027-02-01T00:00:00Z"),
      },
    );

    expect(planned).toHaveLength(1);
  });

  it("skips weekly occurrences that ended before the cutoff and stops at the horizon", () => {
    const planned = planOccurrences(
      { ...weeklyBerlin, recurrenceUntil: null },
      {
        notEndingBefore: new Date("2026-10-25T17:30:00Z"),
        horizon: new Date("2026-11-15T17:00:00Z"),
      },
    );

    expect(planned.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-10-25T17:00:00.000Z",
      "2026-11-01T17:00:00.000Z",
      "2026-11-08T17:00:00.000Z",
      "2026-11-15T17:00:00.000Z",
    ]);
  });

  it("includes the until date itself and nothing after it", () => {
    const planned = planOccurrences(
      { ...weeklyBerlin, recurrenceUntil: "2026-10-25" },
      {
        notEndingBefore: new Date("2026-10-01T00:00:00Z"),
        horizon: new Date("2027-01-01T00:00:00Z"),
      },
    );

    expect(planned).toHaveLength(2);
  });

  it("caps an open series at 26 weeks when the horizon is that far", () => {
    const from = new Date("2026-10-18T00:00:00Z");
    const planned = planOccurrences(
      { ...weeklyBerlin, recurrenceUntil: null },
      { notEndingBefore: from, horizon: new Date(from.getTime() + 26 * 7 * 86_400_000) },
    );

    expect(planned).toHaveLength(26);
    expect(planned.at(-1)?.startsAt.toISOString()).toBe("2027-04-11T16:00:00.000Z");
  });
});

describe("time zone and wall clock validation", () => {
  it.each(["Europe/Berlin", "America/New_York", "UTC", "Asia/Kolkata"])("accepts %s", (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(["", "Mars/Olympus", "Europe/Berlinn", "not a zone"])("rejects %j", (zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });

  it("parses wall clock times with a T or a space and rejects impossible dates", () => {
    expect(parseWallClock("2026-10-18T18:00")).toEqual({
      year: 2026,
      month: 10,
      day: 18,
      hour: 18,
      minute: 0,
    });
    expect(parseWallClock("2026-10-18 18:00:00")).not.toBeNull();
    expect(parseWallClock("2026-02-30T18:00")).toBeNull();
    expect(parseWallClock("2026-10-18T24:00")).toBeNull();
    expect(parseWallClock("2026-10-18T18:00Z")).toBeNull();
  });
});
