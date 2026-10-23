import {
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
  type ScopedQueries,
  type Transaction,
} from "@cohory/db";
import {
  communities,
  creatorFeedback,
  memberships,
  notificationSettings,
  type CreatorMoment,
} from "@cohory/db/schema";
import { and, asc, eq, gt, isNotNull, lt, max } from "drizzle-orm";

import type { CreatorFeedbackStore } from "./store";

function asUser<T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "user_id", userId);
    return fn(tx);
  });
}

function inCommunity<T>(
  db: Database,
  communityId: string,
  userId: string | undefined,
  fn: (queries: ScopedQueries) => Promise<T>,
): Promise<T> {
  return runInCommunity(withCommunity(db, parseCommunityId(communityId)), fn, { userId });
}

async function communitySlug({ tx, communityId }: ScopedQueries): Promise<string | null> {
  const [row] = await tx
    .select({ slug: communities.slug })
    .from(communities)
    .where(eq(communities.id, communityId));
  return row?.slug ?? null;
}

export function createPostgresCreatorFeedbackStore(db: Database): CreatorFeedbackStore {
  return {
    standingIn(userId, communityId) {
      return inCommunity(db, communityId, userId, async (queries) => {
        const slug = await communitySlug(queries);
        if (slug === null) {
          return null;
        }
        const [membership] = await queries.tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            queries.where(
              memberships,
              eq(memberships.userId, userId),
              eq(memberships.status, "active"),
            ),
          );
        return { role: membership?.role ?? null, slug };
      });
    },

    ownerOf(communityId) {
      return inCommunity(db, communityId, undefined, async (queries) => {
        const slug = await communitySlug(queries);
        const [owner] = await queries.tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            queries.where(
              memberships,
              eq(memberships.role, "owner"),
              eq(memberships.status, "active"),
            ),
          )
          .limit(1);
        return slug !== null && owner ? { userId: owner.userId, slug } : null;
      });
    },

    optedOutAt(userId) {
      return asUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({ at: notificationSettings.creatorFeedbackOptedOutAt })
          .from(notificationSettings)
          .where(eq(notificationSettings.userId, userId));
        return row?.at ?? null;
      });
    },

    async setOptedOut(userId, at) {
      await asUser(db, userId, (tx) =>
        tx
          .insert(notificationSettings)
          .values({ userId, creatorFeedbackOptedOutAt: at })
          .onConflictDoUpdate({
            target: notificationSettings.userId,
            set: { creatorFeedbackOptedOutAt: at, updatedAt: new Date() },
          }),
      );
    },

    lastMomentResponseAt(userId) {
      return asUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({ at: max(creatorFeedback.respondedAt) })
          .from(creatorFeedback)
          .where(and(eq(creatorFeedback.userId, userId), eq(creatorFeedback.kind, "moment")));
        return row?.at ?? null;
      });
    },

    oldestPendingMoment(userId, createdAfter) {
      return asUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({ communityId: creatorFeedback.communityId, topic: creatorFeedback.topic })
          .from(creatorFeedback)
          .innerJoin(
            memberships,
            and(
              eq(memberships.communityId, creatorFeedback.communityId),
              eq(memberships.userId, creatorFeedback.userId),
              eq(memberships.role, "owner"),
              eq(memberships.status, "active"),
            ),
          )
          .where(
            and(
              eq(creatorFeedback.userId, userId),
              eq(creatorFeedback.kind, "moment"),
              eq(creatorFeedback.status, "pending"),
              isNotNull(creatorFeedback.communityId),
              gt(creatorFeedback.createdAt, createdAfter),
            ),
          )
          .orderBy(asc(creatorFeedback.createdAt))
          .limit(1);
        return row?.communityId
          ? { communityId: row.communityId, moment: row.topic as CreatorMoment }
          : null;
      });
    },

    insertPendingMoment({ userId, communityId, moment, at }) {
      return inCommunity(db, communityId, userId, async ({ tx, values }) => {
        const inserted = await tx
          .insert(creatorFeedback)
          .values(
            values({
              userId,
              kind: "moment" as const,
              topic: moment,
              status: "pending" as const,
              createdAt: at,
              updatedAt: at,
            }),
          )
          .onConflictDoNothing()
          .returning({ id: creatorFeedback.id });
        return inserted.length > 0;
      });
    },

    respondToMoment({ userId, communityId, moment, status, score, comment, at }) {
      return inCommunity(db, communityId, userId, async ({ tx, where }) => {
        const updated = await tx
          .update(creatorFeedback)
          .set({ status, score, comment, respondedAt: at, updatedAt: at })
          .where(
            where(
              creatorFeedback,
              eq(creatorFeedback.userId, userId),
              eq(creatorFeedback.kind, "moment"),
              eq(creatorFeedback.topic, moment),
              eq(creatorFeedback.status, "pending"),
            ),
          )
          .returning({ id: creatorFeedback.id });
        return updated.length > 0;
      });
    },

    async insertExit({ userId, communityId, action, reason, comment, at }) {
      const row = {
        userId,
        kind: "exit" as const,
        topic: action,
        status: "answered" as const,
        reason,
        comment,
        respondedAt: at,
        createdAt: at,
        updatedAt: at,
      };
      if (communityId === null) {
        await asUser(db, userId, (tx) => tx.insert(creatorFeedback).values(row));
        return;
      }
      await inCommunity(db, communityId, userId, ({ tx, values }) =>
        tx.insert(creatorFeedback).values(values(row)),
      );
    },

    removeCreatedBefore(cutoff) {
      return db.transaction(async (tx) => {
        await setRlsFlag(tx, "feedback_retention");
        const removed = await tx
          .delete(creatorFeedback)
          .where(lt(creatorFeedback.createdAt, cutoff))
          .returning({ id: creatorFeedback.id });
        return removed.length;
      });
    },
  };
}
