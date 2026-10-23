import { describe, expect, it } from "vitest";

import { maxDeliveryAttempts, nextAttemptDelayMs, retryScheduleMs } from "./backoff";

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;

describe("retry schedule", () => {
  it("backs off exponentially from seconds to hours", () => {
    expect(retryScheduleMs).toEqual([
      5 * second,
      5 * minute,
      30 * minute,
      2 * hour,
      5 * hour,
      10 * hour,
      14 * hour,
      20 * hour,
      20 * hour,
    ]);
    for (let index = 1; index < retryScheduleMs.length; index += 1) {
      expect(retryScheduleMs[index]).toBeGreaterThanOrEqual(retryScheduleMs[index - 1] ?? 0);
    }
  });

  it("keeps the whole retry window just under 3 days", () => {
    const total = retryScheduleMs.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThan(72 * hour);
    expect(total).toBeGreaterThan(71 * hour);
  });

  it("gives the delay before the next attempt and stops after the last one", () => {
    expect(maxDeliveryAttempts).toBe(10);
    expect(nextAttemptDelayMs(1)).toBe(5 * second);
    expect(nextAttemptDelayMs(2)).toBe(5 * minute);
    expect(nextAttemptDelayMs(9)).toBe(20 * hour);
    expect(nextAttemptDelayMs(10)).toBeNull();
    expect(nextAttemptDelayMs(11)).toBeNull();
  });
});
