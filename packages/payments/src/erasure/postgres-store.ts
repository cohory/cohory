import type { ScopedQueries } from "@cohory/db";
import {
  paymentCustomers,
  subscriberMoves,
  subscriptionLinks,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import type { ErasureStore } from "./store";

export const endedProviderStatuses = ["canceled", "incomplete_expired"];

export function createErasureStore({ tx, where }: ScopedQueries): ErasureStore {
  return {
    listCustomers(userId) {
      return tx
        .select()
        .from(paymentCustomers)
        .where(where(paymentCustomers, eq(paymentCustomers.userId, userId)))
        .orderBy(asc(paymentCustomers.createdAt));
    },

    listOpenSubscriptions(userId) {
      return tx
        .select()
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            eq(subscriptions.userId, userId),
            isNull(subscriptions.endedAt),
            notInArray(subscriptions.providerStatus, endedProviderStatuses),
          ),
        )
        .orderBy(asc(subscriptions.createdAt));
    },

    async forgetEmail(userId) {
      const email = tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
      const moves = await tx
        .delete(subscriberMoves)
        .where(where(subscriberMoves, inArray(subscriberMoves.email, email)))
        .returning({ id: subscriberMoves.id });
      const links = await tx
        .update(subscriptionLinks)
        .set({ email: sql`'erased-' || ${subscriptionLinks.id} || '@erased.invalid'` })
        .where(
          where(
            subscriptionLinks,
            or(eq(subscriptionLinks.userId, userId), inArray(subscriptionLinks.email, email)),
          ),
        )
        .returning({ id: subscriptionLinks.id });
      return { moves: moves.length, links: links.length };
    },
  };
}
