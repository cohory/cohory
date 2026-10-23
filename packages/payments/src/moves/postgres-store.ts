import type { ScopedQueries } from "@cohory/db";
import { subscriberMoves, users } from "@cohory/db/schema";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { MoveStore } from "./store";

export function createMoveStore({ communityId, tx, where, values }: ScopedQueries): MoveStore {
  const emailOf = (userId: string) =>
    tx.select({ email: users.email }).from(users).where(eq(users.id, userId));

  return {
    async save(batch, at) {
      if (batch.rows.length === 0) {
        return 0;
      }
      const saved = await tx
        .insert(subscriberMoves)
        .values(
          batch.rows.map((row) =>
            values({
              email: row.email,
              freeUntil: row.freeUntil,
              wasPaying: true,
              source: batch.source,
              jobId: batch.jobId,
              createdBy: batch.createdBy,
              createdAt: at,
              updatedAt: at,
            }),
          ),
        )
        .onConflictDoUpdate({
          target: [subscriberMoves.communityId, subscriberMoves.email],
          set: {
            freeUntil: sql`coalesce(excluded.free_until, ${subscriberMoves.freeUntil})`,
            wasPaying: true,
            updatedAt: at,
          },
          setWhere: ne(subscriberMoves.status, "resubscribed"),
        })
        .returning({ id: subscriberMoves.id });
      return saved.length;
    },

    list(limit) {
      return tx
        .select()
        .from(subscriberMoves)
        .where(where(subscriberMoves))
        .orderBy(asc(subscriberMoves.status), desc(subscriberMoves.createdAt))
        .limit(limit);
    },

    async findPendingForUser(userId) {
      const [row] = await tx
        .select()
        .from(subscriberMoves)
        .where(
          where(
            subscriberMoves,
            eq(subscriberMoves.status, "pending"),
            inArray(subscriberMoves.email, emailOf(userId)),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async markResubscribed(userId, subscriptionId, at) {
      await tx
        .update(subscriberMoves)
        .set({ status: "resubscribed", resubscribedAt: at, subscriptionId, updatedAt: at })
        .where(
          where(
            subscriberMoves,
            ne(subscriberMoves.status, "resubscribed"),
            inArray(subscriberMoves.email, emailOf(userId)),
          ),
        );
    },

    async claimReminders({ at, remindedBefore, freeTimeEndedAfter, addedAfter, limit }) {
      const due = and(
        eq(subscriberMoves.status, "pending"),
        or(isNull(subscriberMoves.remindedAt), lt(subscriberMoves.remindedAt, remindedBefore)),
        or(
          gt(subscriberMoves.freeUntil, freeTimeEndedAfter),
          and(isNull(subscriberMoves.freeUntil), gt(subscriberMoves.createdAt, addedAfter)),
        ),
      );
      const claimable = tx
        .select({ id: subscriberMoves.id })
        .from(subscriberMoves)
        .where(where(subscriberMoves, due))
        .orderBy(asc(subscriberMoves.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      // The outer condition is checked again after a concurrent claim commits, so a row
      // claimed by the other click is skipped instead of reminded twice.
      return tx
        .update(subscriberMoves)
        .set({ remindedAt: at, updatedAt: at })
        .where(where(subscriberMoves, inArray(subscriberMoves.id, claimable), due))
        .returning();
    },

    // Serializes pastes in one community so two at once cannot pass the cap together.
    async lockForAdding() {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"subscriber_moves:" + communityId}, 0))`,
      );
    },

    async count() {
      const [row] = await tx
        .select({ total: count() })
        .from(subscriberMoves)
        .where(where(subscriberMoves));
      return row?.total ?? 0;
    },

    async countListed(emails) {
      if (emails.length === 0) {
        return 0;
      }
      const [row] = await tx
        .select({ total: count() })
        .from(subscriberMoves)
        .where(where(subscriberMoves, inArray(subscriberMoves.email, [...emails])));
      return row?.total ?? 0;
    },

    async removeExpired({ settledBefore, undatedBefore }) {
      const removed = await tx
        .delete(subscriberMoves)
        .where(
          where(
            subscriberMoves,
            or(
              lt(subscriberMoves.resubscribedAt, settledBefore),
              and(
                ne(subscriberMoves.status, "resubscribed"),
                or(
                  lt(subscriberMoves.freeUntil, settledBefore),
                  and(
                    isNull(subscriberMoves.freeUntil),
                    lt(subscriberMoves.createdAt, undatedBefore),
                  ),
                ),
              ),
            ),
          ),
        )
        .returning({ id: subscriberMoves.id });
      return removed.length;
    },
  };
}
