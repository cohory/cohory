import { describe, expect, it } from "vitest";

import { metricsWindow, monthlyRecurringMinor, toRevenueMetrics } from "./metrics";

describe("metricsWindow", () => {
  it("starts this month and last month at midnight UTC on the first", () => {
    const window = metricsWindow(new Date("2026-01-15T08:30:00.000Z"));
    expect(window.monthStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(window.lastMonthStart.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });

  it("looks back 14 days for inactive paying members", () => {
    const window = metricsWindow(new Date("2026-10-18T10:00:00.000Z"));
    expect(window.inactiveBefore.toISOString()).toBe("2026-10-04T10:00:00.000Z");
  });
});

describe("monthlyRecurringMinor", () => {
  it("adds yearly amounts divided by 12, rounding half up once on the total", () => {
    expect(monthlyRecurringMinor(4900, 49_000)).toBe(4900 + 4083);
    expect(monthlyRecurringMinor(0, 6)).toBe(1);
    expect(monthlyRecurringMinor(0, 5)).toBe(0);
  });

  it("is zero without subscriptions", () => {
    expect(monthlyRecurringMinor(0, 0)).toBe(0);
  });
});

describe("toRevenueMetrics", () => {
  it("pairs each figure with last month's value", () => {
    const metrics = toRevenueMetrics(
      "usd",
      {
        paying: 3,
        pastDue: 1,
        cancelling: 1,
        payingInactive: 0,
        newThisMonth: 2,
        newLastMonth: 1,
        endedThisMonth: 0,
        endedLastMonth: 2,
        everPaid: true,
        monthlyNowMinor: 9800,
        yearlyNowMinor: 0,
        monthlyAtMonthStartMinor: 4900,
        yearlyAtMonthStartMinor: 12_000,
      },
      { thisMonthMinor: 9800, lastMonthMinor: 4900 },
    );
    expect(metrics.mrrMinor).toEqual({ current: 9800, previous: 5900 });
    expect(metrics.newPaid).toEqual({ current: 2, previous: 1 });
    expect(metrics.cancellations).toEqual({ current: 0, previous: 2 });
    expect(metrics.revenueMinor).toEqual({ current: 9800, previous: 4900 });
  });
});
