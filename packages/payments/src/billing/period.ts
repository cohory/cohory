export interface BillingPeriod {
  readonly start: Date;
  readonly end: Date;
}

function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

export function periodContaining(at: Date): BillingPeriod {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return { start: monthStart(year, month), end: monthStart(year, month + 1) };
}

export function closedPeriod(now: Date): BillingPeriod {
  const current = periodContaining(now);
  return periodContaining(new Date(current.start.getTime() - 1));
}

export function periodStarting(start: Date): BillingPeriod {
  const period = periodContaining(start);
  if (period.start.getTime() !== start.getTime()) {
    throw new RangeError("a billing period starts at midnight UTC on the first day of a month");
  }
  return period;
}

export function nextInvoiceDate(now: Date): Date {
  return periodContaining(now).end;
}

export function periodKey(period: BillingPeriod): string {
  return period.start.toISOString().slice(0, 7);
}
