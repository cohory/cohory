import { findSubscriptionForUserIn, type ScopedQueries } from "@cohory/db";
import {
  membershipPlans,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { desc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";

import { type PaymentsStore, type SubscriptionRecord } from "../repository";
import { first, required } from "./rows";

export function createSubscriptionStore(
  queries: ScopedQueries,
): Pick<
  PaymentsStore,
  | "hasOtherGrantingSubscription"
  | "findEarlierRenewingSubscription"
  | "findCustomer"
  | "findCustomerByExternal"
  | "upsertCustomer"
  | "findSubscriptionForUser"
  | "findSubscription"
  | "findSubscriptionByExternal"
  | "findMirroredExternalIds"
  | "upsertSubscription"
  | "listGrantingExternalIds"
  | "listSubscriptionsWithFee"
  | "setSubscriptionFeeBps"
  | "setSubscriptionAccessState"
  | "listSubscriptions"
> {
  const { tx, where, values } = queries;

  return {
    async hasOtherGrantingSubscription(userId, exceptSubscriptionId) {
      const row = await first(
        tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            where(
              subscriptions,
              eq(subscriptions.userId, userId),
              ne(subscriptions.id, exceptSubscriptionId),
              inArray(subscriptions.accessState, ["granted", "grace"]),
            ),
          )
          .limit(1),
      );
      return row !== null;
    },

    findEarlierRenewingSubscription(subscription) {
      return first(
        tx
          .select()
          .from(subscriptions)
          .where(
            where(
              subscriptions,
              eq(subscriptions.userId, subscription.userId),
              eq(subscriptions.connectionId, subscription.connectionId),
              ne(subscriptions.id, subscription.id),
              inArray(subscriptions.accessState, ["granted", "grace"]),
              eq(subscriptions.cancelAtPeriodEnd, false),
              sql`(${subscriptions.createdAt}, ${subscriptions.id}) < (${subscription.createdAt.toISOString()}::timestamptz, ${subscription.id}::uuid)`,
            ),
          )
          .orderBy(subscriptions.createdAt, subscriptions.id)
          .limit(1),
      );
    },

    findCustomer(userId, connectionId) {
      return first(
        tx
          .select()
          .from(paymentCustomers)
          .where(
            where(
              paymentCustomers,
              eq(paymentCustomers.userId, userId),
              eq(paymentCustomers.connectionId, connectionId),
            ),
          )
          .orderBy(desc(paymentCustomers.createdAt))
          .limit(1),
      );
    },

    findCustomerByExternal(connectionId, externalCustomerId) {
      return first(
        tx
          .select()
          .from(paymentCustomers)
          .where(
            where(
              paymentCustomers,
              eq(paymentCustomers.connectionId, connectionId),
              eq(paymentCustomers.externalCustomerId, externalCustomerId),
            ),
          )
          .limit(1),
      );
    },

    async upsertCustomer(input) {
      await tx.insert(paymentCustomers).values(values(input)).onConflictDoNothing();
      return required(
        tx
          .select()
          .from(paymentCustomers)
          .where(
            where(
              paymentCustomers,
              eq(paymentCustomers.connectionId, input.connectionId),
              eq(paymentCustomers.externalCustomerId, input.externalCustomerId),
            ),
          )
          .limit(1),
      );
    },

    findSubscriptionForUser(userId) {
      return findSubscriptionForUserIn(queries, userId);
    },

    findSubscription(subscriptionId) {
      return first(
        tx
          .select()
          .from(subscriptions)
          .where(where(subscriptions, eq(subscriptions.id, subscriptionId)))
          .limit(1),
      );
    },

    findSubscriptionByExternal(externalSubscriptionId) {
      return first(
        tx
          .select()
          .from(subscriptions)
          .where(
            where(subscriptions, eq(subscriptions.externalSubscriptionId, externalSubscriptionId)),
          )
          .limit(1),
      );
    },

    async findMirroredExternalIds(externalSubscriptionIds) {
      if (externalSubscriptionIds.length === 0) {
        return new Set();
      }
      const rows = await tx
        .select({ id: subscriptions.externalSubscriptionId })
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            inArray(subscriptions.externalSubscriptionId, [...externalSubscriptionIds]),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },

    async upsertSubscription(input) {
      const previous: SubscriptionRecord | null = await first(
        tx
          .select()
          .from(subscriptions)
          .where(
            where(
              subscriptions,
              eq(subscriptions.externalSubscriptionId, input.externalSubscriptionId),
            ),
          )
          .for("update")
          .limit(1),
      );
      if (previous && previous.providerFetchedAt > input.providerFetchedAt) {
        return { record: previous, previous, applied: false };
      }
      const record = previous
        ? await required(
            tx
              .update(subscriptions)
              .set({ ...input, updatedAt: new Date() })
              .where(where(subscriptions, eq(subscriptions.id, previous.id)))
              .returning(),
          )
        : await required(tx.insert(subscriptions).values(values(input)).returning());
      return { record, previous, applied: true };
    },

    async listGrantingExternalIds(connectionId) {
      const rows = await tx
        .select({ id: subscriptions.externalSubscriptionId })
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            eq(subscriptions.connectionId, connectionId),
            inArray(subscriptions.accessState, ["granted", "grace"]),
          ),
        );
      return rows.map((row) => row.id);
    },

    listSubscriptionsWithFee(connectionId) {
      return tx
        .select()
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            eq(subscriptions.connectionId, connectionId),
            gt(subscriptions.applicationFeeBps, 0),
            notInArray(subscriptions.providerStatus, ["canceled", "incomplete_expired"]),
          ),
        )
        .orderBy(desc(subscriptions.createdAt));
    },

    async setSubscriptionFeeBps(subscriptionId, applicationFeeBps) {
      await tx
        .update(subscriptions)
        .set({ applicationFeeBps, updatedAt: new Date() })
        .where(where(subscriptions, eq(subscriptions.id, subscriptionId)));
    },

    async setSubscriptionAccessState(subscriptionId, accessState) {
      await tx
        .update(subscriptions)
        .set({ accessState, updatedAt: new Date() })
        .where(where(subscriptions, eq(subscriptions.id, subscriptionId)));
    },

    async listSubscriptions(limit) {
      return tx
        .select({
          subscription: subscriptions,
          userName: users.name,
          userEmail: users.email,
          plan: {
            currency: membershipPlans.currency,
            monthlyPriceMinor: membershipPlans.monthlyPriceMinor,
            annualPriceMinor: membershipPlans.annualPriceMinor,
          },
          connection: {
            provider: paymentConnections.provider,
            externalAccountId: paymentConnections.externalAccountId,
            livemode: paymentConnections.livemode,
          },
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .leftJoin(membershipPlans, eq(membershipPlans.id, subscriptions.planId))
        .leftJoin(paymentConnections, eq(paymentConnections.id, subscriptions.connectionId))
        .where(where(subscriptions))
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit);
    },
  };
}
