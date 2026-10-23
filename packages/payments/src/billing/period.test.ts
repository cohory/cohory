import { describe, expect, it } from "vitest";

import {
  closedPeriod,
  nextInvoiceDate,
  periodContaining,
  periodKey,
  periodStarting,
} from "./period";

describe("billing periods", () => {
  it("closes the previous calendar month in UTC", () => {
    const period = closedPeriod(new Date("2026-11-01T00:05:00.000Z"));
    expect(period.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rolls the closed period back across a year boundary", () => {
    const period = closedPeriod(new Date("2027-01-15T12:00:00.000Z"));
    expect(periodKey(period)).toBe("2026-12");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("uses UTC even when the local date differs", () => {
    const period = periodContaining(new Date("2026-10-31T23:59:59.999Z"));
    expect(periodKey(period)).toBe("2026-10");
  });

  it("names the first day of next month as the next invoice date", () => {
    expect(nextInvoiceDate(new Date("2026-02-14T08:00:00.000Z")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  it("refuses a period start that is not the first of a month", () => {
    expect(() => periodStarting(new Date("2026-10-02T00:00:00.000Z"))).toThrow(RangeError);
    expect(periodKey(periodStarting(new Date("2026-10-01T00:00:00.000Z")))).toBe("2026-10");
  });
});
