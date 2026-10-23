import { assertCan, type Actor } from "@cohory/authz";

import type { MetricsWindow, RevenueTotals, SubscriptionTotals } from "../metrics/store";
import { withAccess, type Runtime } from "./context";

const dayMs = 24 * 60 * 60 * 1000;

export const inactivePayingDays = 14;

export interface MetricTrend {
  readonly current: number;
  readonly previous: number;
}

export interface RevenueMetrics {
  readonly currency: string | null;
  readonly payingCount: number;
  readonly pastDueCount: number;
  readonly cancellingCount: number;
  readonly payingInactiveCount: number;
  readonly everPaid: boolean;
  readonly mrrMinor: MetricTrend;
  readonly revenueMinor: MetricTrend;
  readonly newPaid: MetricTrend;
  readonly cancellations: MetricTrend;
}

export interface MetricsOperations {
  getRevenueMetrics(actor: Actor, communityId: string): Promise<RevenueMetrics>;
}

export function metricsWindow(now: Date): MetricsWindow {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    now,
    monthStart,
    lastMonthStart,
    inactiveBefore: new Date(now.getTime() - inactivePayingDays * dayMs),
  };
}

export function monthlyRecurringMinor(monthlyMinor: number, yearlyMinor: number): number {
  return monthlyMinor + Math.floor((yearlyMinor + 6) / 12);
}

export function toRevenueMetrics(
  currency: string | null,
  subscriptions: SubscriptionTotals,
  revenue: RevenueTotals,
): RevenueMetrics {
  return {
    currency,
    payingCount: subscriptions.paying,
    pastDueCount: subscriptions.pastDue,
    cancellingCount: subscriptions.cancelling,
    payingInactiveCount: subscriptions.payingInactive,
    everPaid: subscriptions.everPaid,
    mrrMinor: {
      current: monthlyRecurringMinor(subscriptions.monthlyNowMinor, subscriptions.yearlyNowMinor),
      previous: monthlyRecurringMinor(
        subscriptions.monthlyAtMonthStartMinor,
        subscriptions.yearlyAtMonthStartMinor,
      ),
    },
    revenueMinor: { current: revenue.thisMonthMinor, previous: revenue.lastMonthMinor },
    newPaid: { current: subscriptions.newThisMonth, previous: subscriptions.newLastMonth },
    cancellations: {
      current: subscriptions.endedThisMonth,
      previous: subscriptions.endedLastMonth,
    },
  };
}

export function createMetricsOperations(runtime: Runtime): MetricsOperations {
  return {
    async getRevenueMetrics(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        const window = metricsWindow(runtime.now());
        const currency = await store.metrics.metricsCurrency();
        const subscriptions = await store.metrics.subscriptionTotals(window, currency);
        const revenue = currency
          ? await store.metrics.revenueTotals(window, currency)
          : { thisMonthMinor: 0, lastMonthMinor: 0 };
        return toRevenueMetrics(currency, subscriptions, revenue);
      });
    },
  };
}
