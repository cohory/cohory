export const paidEndGraceMs = 7 * 24 * 60 * 60 * 1000;

// A period that already ended still leaves a week to subscribe again before access stops.
export function paidThrough(currentPeriodEnd: string | null, restoredAt: Date): Date | null {
  if (!currentPeriodEnd) {
    return null;
  }
  return new Date(
    Math.max(new Date(currentPeriodEnd).getTime(), restoredAt.getTime() + paidEndGraceMs),
  );
}
