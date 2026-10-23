import type { ScopedQueries } from "@cohory/db";
import { payments, subscriptions } from "@cohory/db/schema";
import { desc, eq, gt, inArray, min, sql } from "drizzle-orm";

import type { SubscriberTenure, SubscriptionOrigin, TenureStore } from "./store";

function originOf(value: string): SubscriptionOrigin {
  return value === "linked_import" ? "linked_import" : "created_by_cohory";
}

function paidSinceFor(origin: SubscriptionOrigin, firstPaidAt: Date | null, createdAt: Date): Date {
  if (origin === "linked_import" || firstPaidAt === null) {
    return createdAt;
  }
  return firstPaidAt;
}

export function createTenureStore({ tx, where }: ScopedQueries): TenureStore {
  return {
    async listTenure(userIds) {
      if (userIds.length === 0) {
        return [];
      }
      const firstPayment = tx
        .select({
          subscriptionId: payments.subscriptionId,
          firstPaidAt: min(payments.occurredAt).as("first_paid_at"),
        })
        .from(payments)
        .where(where(payments, gt(payments.amountMinor, 0)))
        .groupBy(payments.subscriptionId)
        .as("first_payment");
      const rows = await tx
        .select({
          subscription: subscriptions,
          firstPaidAt: firstPayment.firstPaidAt,
        })
        .from(subscriptions)
        .leftJoin(firstPayment, eq(firstPayment.subscriptionId, subscriptions.id))
        .where(where(subscriptions, inArray(subscriptions.userId, [...userIds])))
        .orderBy(
          subscriptions.userId,
          sql`case ${subscriptions.accessState} when 'granted' then 0 when 'grace' then 1 when 'none' then 2 else 3 end`,
          subscriptions.cancelAtPeriodEnd,
          desc(subscriptions.updatedAt),
        );
      const picked = new Map<string, SubscriberTenure>();
      for (const { subscription, firstPaidAt } of rows) {
        if (picked.has(subscription.userId)) {
          continue;
        }
        const origin = originOf(subscription.origin);
        picked.set(subscription.userId, {
          userId: subscription.userId,
          providerStatus: subscription.providerStatus,
          accessState: subscription.accessState,
          interval: subscription.interval,
          origin,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          currentPeriodEnd: subscription.currentPeriodEnd,
          paidSince: paidSinceFor(origin, firstPaidAt, subscription.createdAt),
        });
      }
      return [...picked.values()];
    },
  };
}
