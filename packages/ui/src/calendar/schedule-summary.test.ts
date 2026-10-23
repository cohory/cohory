import { describe, expect, it } from "vitest";

import { repeatLine, scheduleSummary, zoneChange } from "./schedule-summary";

describe("scheduleSummary", () => {
  const weekly = {
    date: "2026-10-27",
    time: "17:00",
    timeZone: "America/New_York",
    recurrence: "weekly" as const,
  };

  it("names the weekday in the event zone and the time for the creator", () => {
    expect(scheduleSummary(weekly, "Europe/Istanbul")).toBe(
      "Every Tuesday, 17:00 EDT (Wednesday 00:00 for you)",
    );
  });

  it("leaves out the creator's time when it is the same", () => {
    expect(scheduleSummary(weekly, "America/Toronto")).toBe("Every Tuesday, 17:00 EDT");
  });

  it("gives the full date of a one-off event", () => {
    expect(scheduleSummary({ ...weekly, recurrence: null }, "America/Chicago")).toBe(
      "Tuesday, 27 October 2026, 17:00 EDT (16:00 for you)",
    );
  });

  it("says nothing while the date or time is empty", () => {
    expect(scheduleSummary({ ...weekly, time: "" }, "UTC")).toBeNull();
  });
});

describe("zoneChange", () => {
  it("offers to keep the wall clock or the moment when the zone changes", () => {
    const change = zoneChange(
      { date: "2026-10-18", time: "19:00", timeZone: "Europe/Istanbul" },
      "Europe/London",
    );

    expect(change?.keepClock.label).toBe("Keep 19:00 in London (moves the event 2 hours later)");
    expect(change?.keepMoment).toEqual({
      label: "Keep the same moment (17:00 in London)",
      value: { date: "2026-10-18", time: "17:00" },
    });
  });

  it("asks nothing when the zone is the same or the offset does not differ", () => {
    const base = { date: "2026-10-18", time: "19:00", timeZone: "Europe/Berlin" };

    expect(zoneChange(base, "Europe/Berlin")).toBeNull();
    expect(zoneChange(base, "Europe/Paris")).toBeNull();
  });
});

describe("repeatLine", () => {
  it("names the weekday in the event zone", () => {
    expect(repeatLine("2026-10-27T21:00:00.000Z", "America/New_York", "15 December 2026")).toBe(
      "Every Tuesday until 15 December 2026",
    );
    expect(repeatLine("2026-10-27T21:00:00.000Z", "Europe/Istanbul", null)).toBe("Every Wednesday");
  });
});
