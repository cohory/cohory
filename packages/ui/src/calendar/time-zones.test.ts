import { describe, expect, it } from "vitest";

import { canonicalZone, timeZoneChoices, timeZoneOption, zoneInstant } from "./time-zones";

const summer = new Date("2026-07-01T12:00:00Z");

describe("time zone options", () => {
  it("labels a zone by city with its offset on the given date", () => {
    expect(timeZoneOption("America/New_York", summer).label).toBe("New York (UTC−4)");
    expect(timeZoneOption("Asia/Calcutta", summer).label).toBe("Kolkata (UTC+5:30)");
    expect(timeZoneOption("UTC", summer).label).toBe("UTC");
  });

  it("finds a zone by city, country, and abbreviation", () => {
    const newYork = timeZoneOption("America/New_York", summer).search;
    const berlin = timeZoneOption("Europe/Berlin", summer).search;

    expect(newYork).toContain("new york");
    expect(newYork).toContain("united states");
    expect(newYork).toContain("edt");
    expect(berlin).toContain("germany");
  });

  it("drops old names for renamed zones and keeps one entry each", () => {
    expect(canonicalZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(timeZoneChoices(["Europe/Kiev", "Europe/Kyiv", "Asia/Calcutta", "UTC"])).toEqual([
      "Asia/Kolkata",
      "Europe/Kyiv",
      "UTC",
    ]);
  });
});

describe("zoneInstant", () => {
  it("turns a wall clock in a zone into the moment it names", () => {
    expect(zoneInstant("2026-10-27", "17:00", "America/New_York")?.toISOString()).toBe(
      "2026-10-27T21:00:00.000Z",
    );
    expect(zoneInstant("2026-11-03", "17:00", "America/New_York")?.toISOString()).toBe(
      "2026-11-03T22:00:00.000Z",
    );
    expect(zoneInstant("2026-10-18", "19:00", "Europe/Istanbul")?.toISOString()).toBe(
      "2026-10-18T16:00:00.000Z",
    );
  });

  it("returns null for a date or time it cannot read", () => {
    expect(zoneInstant("", "17:00", "UTC")).toBeNull();
    expect(zoneInstant("2026-10-27", "", "UTC")).toBeNull();
  });
});
