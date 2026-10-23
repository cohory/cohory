const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;

export const retryScheduleMs: readonly number[] = [
  5 * second,
  5 * minute,
  30 * minute,
  2 * hour,
  5 * hour,
  10 * hour,
  14 * hour,
  20 * hour,
  20 * hour,
];

export const maxDeliveryAttempts = retryScheduleMs.length + 1;

export function nextAttemptDelayMs(attemptsMade: number): number | null {
  return retryScheduleMs[attemptsMade - 1] ?? null;
}
