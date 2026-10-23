import type { ScopedQueries } from "@cohory/db";
import { compedMemberships, subscriptions } from "@cohory/db/schema";
import { gt, inArray, isNull, or } from "drizzle-orm";

import type { AccessSummaryStore } from "./store";

export function createAccessSummaryStore({ tx, where }: ScopedQueries): AccessSummaryStore {
  return {
    async listAccessFacts(userIds, now) {
      if (userIds !== null && userIds.length === 0) {
        return { subscriptions: [], comps: [] };
      }
      const ids = userIds === null ? null : [...userIds];
      const subscriptionRows = await tx
        .select({
          userId: subscriptions.userId,
          accessState: subscriptions.accessState,
          interval: subscriptions.interval,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            inArray(subscriptions.accessState, ["granted", "grace"]),
            ids ? inArray(subscriptions.userId, ids) : undefined,
          ),
        );
      const compRows = await tx
        .select({ userId: compedMemberships.userId, expiresAt: compedMemberships.expiresAt })
        .from(compedMemberships)
        .where(
          where(
            compedMemberships,
            isNull(compedMemberships.endedAt),
            or(isNull(compedMemberships.expiresAt), gt(compedMemberships.expiresAt, now)),
            ids ? inArray(compedMemberships.userId, ids) : undefined,
          ),
        );
      return { subscriptions: subscriptionRows, comps: compRows };
    },
  };
}
