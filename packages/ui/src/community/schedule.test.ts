import { describe, expect, it } from "vitest";

import { localInputValue, scheduleInstant, schedulePresets, timeZoneLabel } from "./schedule";

describe("scheduleInstant", () => {
  it("turns a local date and time into an ISO instant", () => {
    const local = "2026-11-02T09:30";
    expect(scheduleInstant(local)).toBe(new Date(2026, 10, 2, 9, 30).toISOString());
  });

  it("returns null for an empty or invalid value", () => {
    expect(scheduleInstant("")).toBeNull();
    expect(scheduleInstant("not a date")).toBeNull();
  });
});

describe("localInputValue", () => {
  it("formats an instant for a datetime-local field in the browser's zone", () => {
    const at = new Date(2026, 10, 2, 9, 5);
    expect(localInputValue(at)).toBe("2026-11-02T09:05");
  });
});

describe("schedulePresets", () => {
  it("offers tomorrow and the next Monday at 09:00", () => {
    const thursday = new Date(2026, 9, 22, 15, 0);
    expect(schedulePresets(thursday)).toEqual({
      tomorrow: "2026-10-23T09:00",
      monday: "2026-10-26T09:00",
    });
  });

  it("skips to the following Monday on a Monday", () => {
    const monday = new Date(2026, 9, 26, 8, 0);
    expect(schedulePresets(monday).monday).toBe("2026-11-02T09:00");
  });

  it("rolls over the end of a month", () => {
    const sunday = new Date(2026, 9, 31, 22, 0);
    expect(schedulePresets(sunday)).toEqual({
      tomorrow: "2026-11-01T09:00",
      monday: "2026-11-02T09:00",
    });
  });
});

describe("timeZoneLabel", () => {
  it("names the browser's time zone", () => {
    expect(timeZoneLabel()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
