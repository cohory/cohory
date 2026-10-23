import { setRlsFlag, type Database, type Transaction } from "@cohory/db";
import { providerEvents } from "@cohory/db/schema";
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { abandonedEventMarker, type PaymentsRepository } from "../repository";
import { first } from "./rows";

const stripeProviders = ["stripe_connect", "stripe_own_keys"] as const;

export function asWebhook<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setRlsFlag(tx, "payments_webhook");
    return fn(tx);
  });
}

export function createEventRepository(
  db: Database,
): Pick<
  PaymentsRepository,
  | "recordEvent"
  | "claimEvent"
  | "finishEvent"
  | "failEvent"
  | "listStaleEvents"
  | "listAbandonedEvents"
  | "markEventsAbandoned"
  | "findStripeEvent"
> {
  return {
    recordEvent(input) {
      return asWebhook(db, async (tx) => {
        await tx
          .insert(providerEvents)
          .values({
            provider: input.provider,
            externalEventId: input.externalEventId,
            externalAccountId: input.externalAccountId,
            connectionId: input.connectionId,
            type: input.type,
            livemode: input.livemode,
            payloadHash: input.payloadHash,
            receivedAt: input.now,
          })
          .onConflictDoNothing();
        const row = await first(
          tx
            .select({ id: providerEvents.id, processedAt: providerEvents.processedAt })
            .from(providerEvents)
            .where(
              and(
                eq(providerEvents.provider, input.provider),
                eq(providerEvents.externalEventId, input.externalEventId),
              ),
            )
            .limit(1),
        );
        if (!row) {
          throw new Error("provider event was not recorded");
        }
        return { rowId: row.id, processed: row.processedAt !== null };
      });
    },

    claimEvent(rowId, now, leaseMs) {
      return asWebhook(db, async (tx) => {
        const leaseExpired = new Date(now.getTime() - leaseMs);
        const claimed = await first(
          tx
            .update(providerEvents)
            .set({
              claimedAt: now,
              attempts: sql`${providerEvents.attempts} + 1`,
              error: null,
            })
            .where(
              and(
                eq(providerEvents.id, rowId),
                isNull(providerEvents.processedAt),
                or(isNull(providerEvents.claimedAt), lt(providerEvents.claimedAt, leaseExpired)),
              ),
            )
            .returning({
              rowId: providerEvents.id,
              externalEventId: providerEvents.externalEventId,
              externalAccountId: providerEvents.externalAccountId,
              type: providerEvents.type,
            }),
        );
        if (claimed) {
          return { kind: "claimed", event: claimed };
        }
        const existing = await first(
          tx
            .select({ processedAt: providerEvents.processedAt })
            .from(providerEvents)
            .where(eq(providerEvents.id, rowId))
            .limit(1),
        );
        if (!existing) {
          return { kind: "missing" };
        }
        return existing.processedAt ? { kind: "duplicate" } : { kind: "in_progress" };
      });
    },

    async finishEvent(rowId, communityId, at) {
      await asWebhook(db, (tx) =>
        tx
          .update(providerEvents)
          .set({ processedAt: at, communityId, error: null })
          .where(eq(providerEvents.id, rowId)),
      );
    },

    async failEvent(rowId, message) {
      await asWebhook(db, (tx) =>
        tx
          .update(providerEvents)
          .set({ claimedAt: null, error: message.slice(0, 500) })
          .where(eq(providerEvents.id, rowId)),
      );
    },

    listStaleEvents(input) {
      return asWebhook(db, (tx) =>
        tx
          .select({ rowId: providerEvents.id, connectionId: providerEvents.connectionId })
          .from(providerEvents)
          .where(
            and(
              isNull(providerEvents.processedAt),
              inArray(providerEvents.provider, stripeProviders),
              lt(providerEvents.receivedAt, input.receivedBefore),
              gt(providerEvents.receivedAt, input.receivedAfter),
              or(
                isNull(providerEvents.claimedAt),
                lt(providerEvents.claimedAt, input.claimedBefore),
              ),
            ),
          )
          .orderBy(providerEvents.receivedAt)
          .limit(input.limit),
      );
    },

    listAbandonedEvents(receivedBefore, limit) {
      return asWebhook(db, (tx) =>
        tx
          .select({
            rowId: providerEvents.id,
            provider: providerEvents.provider,
            externalEventId: providerEvents.externalEventId,
            type: providerEvents.type,
          })
          .from(providerEvents)
          .where(
            and(
              isNull(providerEvents.processedAt),
              lt(providerEvents.receivedAt, receivedBefore),
              or(isNull(providerEvents.error), ne(providerEvents.error, abandonedEventMarker)),
            ),
          )
          .orderBy(providerEvents.receivedAt)
          .limit(limit),
      );
    },

    async markEventsAbandoned(rowIds) {
      if (rowIds.length === 0) {
        return;
      }
      await asWebhook(db, (tx) =>
        tx
          .update(providerEvents)
          .set({ error: abandonedEventMarker })
          .where(and(inArray(providerEvents.id, [...rowIds]), isNull(providerEvents.processedAt))),
      );
    },

    findStripeEvent(externalEventId) {
      return asWebhook(db, async (tx) => {
        const row = await first(
          tx
            .select({
              rowId: providerEvents.id,
              connectionId: providerEvents.connectionId,
              processedAt: providerEvents.processedAt,
            })
            .from(providerEvents)
            .where(
              and(
                eq(providerEvents.externalEventId, externalEventId),
                inArray(providerEvents.provider, stripeProviders),
              ),
            )
            .limit(1),
        );
        return row
          ? {
              rowId: row.rowId,
              connectionId: row.connectionId,
              processed: row.processedAt !== null,
            }
          : null;
      });
    },
  };
}
