import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  dateKey,
  durationMinutes,
  formatDateLong,
  formatDuration,
  formatTimeRange,
  monthGrid,
  occurrencePhase,
  zoneAbbreviation,
} from "./time";

const BERLIN = "Europe/Berlin";

describe("zoneAbbreviation", () => {
  it("switches from CEST to CET across the Berlin DST change on 2026-10-25", () => {
    expect(zoneAbbreviation(BERLIN, "2026-10-25T00:30:00Z")).toBe("CEST");
    expect(zoneAbbreviation(BERLIN, "2026-10-25T01:30:00Z")).toBe("CET");
  });

  it("prefers a named abbreviation and falls back to the offset", () => {
    expect(zoneAbbreviation("America/New_York", "2026-12-01T12:00:00Z", "en-GB")).toBe("EST");
    expect(zoneAbbreviation("Asia/Kolkata", "2026-12-01T12:00:00Z")).toBe("GMT+5:30");
    expect(zoneAbbreviation("UTC", "2026-12-01T12:00:00Z")).toBe("UTC");
  });
});

describe("formatTimeRange", () => {
  it("keeps the same wall clock time for a weekly series across the DST change", () => {
    expect(formatTimeRange("2026-10-24T16:00:00Z", "2026-10-24T17:00:00Z", BERLIN)).toBe(
      "18:00–19:00 CEST",
    );
    expect(formatTimeRange("2026-10-31T17:00:00Z", "2026-10-31T18:00:00Z", BERLIN)).toBe(
      "18:00–19:00 CET",
    );
  });

  it("shows both zones when an occurrence spans the repeated hour", () => {
    expect(formatTimeRange("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", BERLIN)).toBe(
      "02:30 CEST – 02:30 CET",
    );
  });

  it("names the end day when an occurrence runs past midnight", () => {
    expect(formatTimeRange("2026-11-02T22:00:00Z", "2026-11-03T00:30:00Z", BERLIN)).toBe(
      "23:00 CET – 3 Nov, 01:30 CET",
    );
  });

  it("renders in the zone passed by the caller", () => {
    expect(formatTimeRange("2026-11-03T17:00:00Z", "2026-11-03T18:00:00Z", "UTC")).toBe(
      "17:00–18:00 UTC",
    );
  });
});

describe("dateKey and formatDateLong", () => {
  it("resolves the calendar day in the given zone around the DST change", () => {
    expect(dateKey("2026-10-24T22:30:00Z", BERLIN)).toBe("2026-10-25");
    expect(dateKey("2026-10-25T22:30:00Z", BERLIN)).toBe("2026-10-25");
    expect(dateKey("2026-10-25T23:30:00Z", BERLIN)).toBe("2026-10-26");
    expect(dateKey("2026-10-24T22:30:00Z", "UTC")).toBe("2026-10-24");
  });

  it("writes the full date with weekday in the zone", () => {
    expect(formatDateLong("2026-10-24T22:30:00Z", BERLIN)).toMatch(/Sunday,? 25 October 2026/);
  });
});

describe("monthGrid", () => {
  it("returns six rows of seven ISO dates starting on Monday", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(6);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid[0]?.[0]).toMatchObject({ date: "2026-09-28", inMonth: false, weekday: 1 });
    expect(grid[0]?.[3]).toMatchObject({ date: "2026-10-01", day: 1, inMonth: true });
    expect(grid[5]?.[6]?.date).toBe("2026-11-08");
  });

  it("does not repeat or skip the DST day", () => {
    const dates = monthGrid("2026-10")
      .flat()
      .map((cell) => cell.date);
    expect(new Set(dates).size).toBe(42);
    expect(dates).toContain("2026-10-25");
    expect(dates.indexOf("2026-10-26") - dates.indexOf("2026-10-25")).toBe(1);
  });

  it("starts on the first when the month begins on the week start", () => {
    expect(monthGrid("2026-02", 0)[0]?.[0]?.date).toBe("2026-02-01");
    expect(monthGrid("2026-02", 1)[0]?.[0]?.date).toBe("2026-01-26");
    expect(monthGrid("2026-02", 0)[5]?.[6]?.date).toBe("2026-03-14");
  });

  it("crosses year boundaries and handles leap years", () => {
    expect(monthGrid("2026-12")[5]?.[6]?.date).toBe("2027-01-10");
    expect(monthGrid("2027-01")[0]?.[0]?.date).toBe("2026-12-28");
    const february = monthGrid("2028-02")
      .flat()
      .filter((cell) => cell.inMonth);
    expect(february).toHaveLength(29);
  });
});

describe("date arithmetic", () => {
  it("adds months and days across year ends", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("measures duration in real minutes across the repeated hour", () => {
    expect(durationMinutes("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z")).toBe(60);
    expect(formatDuration(45)).toBe("45 minutes");
    expect(formatDuration(60)).toBe("1 hour");
    expect(formatDuration(90)).toBe("1 hour 30 minutes");
    expect(formatDuration(120)).toBe("2 hours");
  });

  it("opens the join window 15 minutes before the start", () => {
    const start = "2026-11-03T17:00:00Z";
    const end = "2026-11-03T18:00:00Z";
    expect(occurrencePhase(start, end, new Date("2026-11-03T16:44:00Z"))).toBe("upcoming");
    expect(occurrencePhase(start, end, new Date("2026-11-03T16:45:00Z"))).toBe("joinable");
    expect(occurrencePhase(start, end, new Date("2026-11-03T17:30:00Z"))).toBe("live");
    expect(occurrencePhase(start, end, new Date("2026-11-03T18:00:00Z"))).toBe("past");
  });
});
