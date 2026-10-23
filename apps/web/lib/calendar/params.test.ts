import { describe, expect, it } from "vitest";

import { calendarHref, occurrenceHref, occurrenceIcsHref } from "./hrefs";
import { listRange, monthRange, parseEditFlag, parseMonth, parseView } from "./params";

describe("calendar URL params", () => {
  it("parses the view and ignores anything else", () => {
    expect(parseView("month")).toBe("month");
    expect(parseView("list")).toBe("list");
    expect(parseView(["list", "month"])).toBe("list");
    expect(parseView("week")).toBeNull();
    expect(parseView(undefined)).toBeNull();
  });

  it("parses YYYY-MM months and rejects malformed or out of range values", () => {
    expect(parseMonth("2026-11")).toBe("2026-11");
    expect(parseMonth("2026-1")).toBeNull();
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-00")).toBeNull();
    expect(parseMonth("1969-12")).toBeNull();
    expect(parseMonth("2026-11-01")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });

  it("reads the edit flag only when it is 1", () => {
    expect(parseEditFlag("1")).toBe(true);
    expect(parseEditFlag("true")).toBe(false);
    expect(parseEditFlag(undefined)).toBe(false);
  });

  it("covers the whole six week grid with a day of slack on each side", () => {
    const range = monthRange("2026-11");
    expect(range.from.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-12-08T00:00:00.000Z");
  });

  it("lists the next 8 weeks", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    expect(listRange(now).to.toISOString()).toBe("2026-12-13T10:00:00.000Z");
  });

  it("builds calendar links", () => {
    expect(calendarHref("yoga")).toBe("/c/yoga/calendar");
    expect(calendarHref("yoga", { view: "month", month: "2026-11" })).toBe(
      "/c/yoga/calendar?view=month&month=2026-11",
    );
    expect(occurrenceHref("yoga", "call", "abc", { edit: true })).toBe(
      "/c/yoga/calendar/call/abc?edit=1",
    );
    expect(occurrenceIcsHref("yoga", "abc")).toBe(
      "/api/v1/communities/yoga/calendar/occurrences/abc/ics",
    );
  });
});
