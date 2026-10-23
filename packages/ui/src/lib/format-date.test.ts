import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatDateTimeWithZone } from "./format-date";

const instant = "2026-10-25T06:00:00.000Z";

describe("formatDate", () => {
  it("prints the day before the month in the app locale", () => {
    expect(formatDate(instant, { timeZone: "UTC" })).toBe("25 Oct 2026");
  });

  it("picks the calendar day in the given time zone", () => {
    expect(formatDate("2026-10-25T23:30:00.000Z", { timeZone: "Europe/Istanbul" })).toBe(
      "26 Oct 2026",
    );
  });

  it("supports the long style", () => {
    expect(formatDate(new Date(instant), { timeZone: "UTC", style: "long" })).toBe(
      "25 October 2026",
    );
  });
});

describe("formatDateTime", () => {
  it("prints a 24 hour time in the given time zone", () => {
    expect(formatDateTime(instant, { timeZone: "Europe/Istanbul" })).toBe("25 Oct 2026, 09:00");
  });
});

describe("formatDateTimeWithZone", () => {
  it("names the time zone after the time", () => {
    expect(formatDateTimeWithZone(instant, { timeZone: "Europe/Istanbul", style: "full" })).toBe(
      "Sunday, 25 October 2026 at 09:00 (Europe/Istanbul)",
    );
  });

  it("uses the medium date style by default", () => {
    expect(formatDateTimeWithZone(instant, { timeZone: "UTC" })).toBe("25 Oct 2026, 06:00 (UTC)");
  });
});
