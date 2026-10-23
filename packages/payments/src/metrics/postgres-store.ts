import type { ScopedQueries } from "@cohory/db";
import { membershipPlans, memberships, payments, sessions, subscriptions } from "@cohory/db/schema";
import { desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";

import type { MetricsStore, MetricsWindow, SubscriptionTotals } from "./store";

const payingNow = sql`${subscriptions.accessState} in ('granted', 'grace') and ${subscriptions.endedAt} is null`;

function at(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}

function payingAt(start: Date): SQL {
  return sql`${subscriptions.accessState} <> 'none' and ${subscriptions.createdAt} < ${at(start)} and (${subscriptions.endedAt} >= ${at(start)} or (${subscriptions.endedAt} is null and ${subscriptions.accessState} in ('granted', 'grace')))`;
}

function between(column: SQL, from: Date, to: Date): SQL {
  return sql`${column} >= ${at(from)} and ${column} < ${at(to)}`;
}

function inactiveSince(cutoff: Date): SQL {
  return sql`exists (select 1 from ${memberships} where ${memberships.communityId} = ${subscriptions.communityId} and ${memberships.userId} = ${subscriptions.userId} and ${memberships.status} = 'active' and coalesce(${memberships.lastSeenAt}, ${memberships.joinedAt}, ${memberships.createdAt}) < ${at(cutoff)}) and not exists (select 1 from ${sessions} where ${sessions.userId} = ${subscriptions.userId} and ${sessions.updatedAt} >= ${at(cutoff)})`;
}

function counted(condition: SQL): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

function summed(amount: SQL, condition: SQL): SQL<number> {
  return sql<number>`coalesce(sum(${amount}) filter (where ${condition}), 0)`.mapWith(Number);
}

export function createMetricsStore({ tx, where }: ScopedQueries): MetricsStore {
  return {
    async metricsCurrency() {
      const [plan] = await tx
        .select({ currency: membershipPlans.currency })
        .from(membershipPlans)
        .where(where(membershipPlans, isNotNull(membershipPlans.connectionId)))
        .orderBy(sql`${membershipPlans.archivedAt} is null desc`, desc(membershipPlans.createdAt))
        .limit(1);
      if (plan) {
        return plan.currency;
      }
      const [payment] = await tx
        .select({ currency: payments.currency })
        .from(payments)
        .where(where(payments))
        .orderBy(desc(payments.occurredAt))
        .limit(1);
      return payment?.currency ?? null;
    },

    async subscriptionTotals(window: MetricsWindow, currency: string | null) {
      const latestPayment = sql`(select ${payments.amountMinor} - ${payments.taxMinor} from ${payments} where ${payments.subscriptionId} = ${subscriptions.id} and ${payments.currency} = ${currency} and ${payments.amountMinor} > 0 order by ${payments.occurredAt} desc limit 1)`;
      const planPrice = sql`case when ${membershipPlans.currency} = ${currency} then (case when ${subscriptions.interval} = 'year' then ${membershipPlans.annualPriceMinor} else ${membershipPlans.monthlyPriceMinor} end) end`;
      const amount = sql`coalesce(${latestPayment}, ${planPrice}, 0)`;
      const yearly = sql`${subscriptions.interval} = 'year'`;
      const monthly = sql`${subscriptions.interval} is distinct from 'year'`;
      const startedFresh = sql`${subscriptions.origin} = 'created_by_cohory' and ${subscriptions.accessState} <> 'none'`;
      const [row] = await tx
        .select({
          paying: counted(payingNow),
          pastDue: counted(sql`${payingNow} and ${subscriptions.accessState} = 'grace'`),
          cancelling: counted(sql`${payingNow} and ${subscriptions.cancelAtPeriodEnd}`),
          payingInactive: counted(sql`${payingNow} and ${inactiveSince(window.inactiveBefore)}`),
          newThisMonth: counted(
            sql`${startedFresh} and ${between(sql`${subscriptions.createdAt}`, window.monthStart, window.now)}`,
          ),
          newLastMonth: counted(
            sql`${startedFresh} and ${between(sql`${subscriptions.createdAt}`, window.lastMonthStart, window.monthStart)}`,
          ),
          endedThisMonth: counted(
            between(sql`${subscriptions.endedAt}`, window.monthStart, window.now),
          ),
          endedLastMonth: counted(
            between(sql`${subscriptions.endedAt}`, window.lastMonthStart, window.monthStart),
          ),
          everPaid: counted(sql`${subscriptions.accessState} <> 'none'`),
          monthlyNowMinor: summed(amount, sql`${payingNow} and ${monthly}`),
          yearlyNowMinor: summed(amount, sql`${payingNow} and ${yearly}`),
          monthlyAtMonthStartMinor: summed(
            amount,
            sql`${payingAt(window.monthStart)} and ${monthly}`,
          ),
          yearlyAtMonthStartMinor: summed(
            amount,
            sql`${payingAt(window.monthStart)} and ${yearly}`,
          ),
        })
        .from(subscriptions)
        .leftJoin(membershipPlans, eq(membershipPlans.id, subscriptions.planId))
        .where(where(subscriptions));
      const totals: SubscriptionTotals = {
        paying: row?.paying ?? 0,
        pastDue: row?.pastDue ?? 0,
        cancelling: row?.cancelling ?? 0,
        payingInactive: row?.payingInactive ?? 0,
        newThisMonth: row?.newThisMonth ?? 0,
        newLastMonth: row?.newLastMonth ?? 0,
        endedThisMonth: row?.endedThisMonth ?? 0,
        endedLastMonth: row?.endedLastMonth ?? 0,
        everPaid: (row?.everPaid ?? 0) > 0,
        monthlyNowMinor: row?.monthlyNowMinor ?? 0,
        yearlyNowMinor: row?.yearlyNowMinor ?? 0,
        monthlyAtMonthStartMinor: row?.monthlyAtMonthStartMinor ?? 0,
        yearlyAtMonthStartMinor: row?.yearlyAtMonthStartMinor ?? 0,
      };
      return totals;
    },

    async revenueTotals(window, currency) {
      const net = sql`greatest(${payments.amountMinor} - ${payments.taxMinor} - ${payments.refundedMinor}, 0)`;
      const [row] = await tx
        .select({
          thisMonthMinor: summed(
            net,
            between(sql`${payments.occurredAt}`, window.monthStart, window.now),
          ),
          lastMonthMinor: summed(
            net,
            between(sql`${payments.occurredAt}`, window.lastMonthStart, window.monthStart),
          ),
        })
        .from(payments)
        .where(
          where(
            payments,
            eq(payments.currency, currency),
            gte(payments.occurredAt, window.lastMonthStart),
            lt(payments.occurredAt, window.now),
          ),
        );
      return { thisMonthMinor: row?.thisMonthMinor ?? 0, lastMonthMinor: row?.lastMonthMinor ?? 0 };
    },
  };
}
