export interface MetricsWindow {
  readonly now: Date;
  readonly monthStart: Date;
  readonly lastMonthStart: Date;
  readonly inactiveBefore: Date;
}

export interface SubscriptionTotals {
  readonly paying: number;
  readonly pastDue: number;
  readonly cancelling: number;
  readonly payingInactive: number;
  readonly newThisMonth: number;
  readonly newLastMonth: number;
  readonly endedThisMonth: number;
  readonly endedLastMonth: number;
  readonly everPaid: boolean;
  readonly monthlyNowMinor: number;
  readonly yearlyNowMinor: number;
  readonly monthlyAtMonthStartMinor: number;
  readonly yearlyAtMonthStartMinor: number;
}

export interface RevenueTotals {
  readonly thisMonthMinor: number;
  readonly lastMonthMinor: number;
}

export interface MetricsStore {
  metricsCurrency(): Promise<string | null>;
  subscriptionTotals(window: MetricsWindow, currency: string | null): Promise<SubscriptionTotals>;
  revenueTotals(window: MetricsWindow, currency: string): Promise<RevenueTotals>;
}
