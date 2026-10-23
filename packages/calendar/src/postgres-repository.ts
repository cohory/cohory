import {
  communityIdSchema,
  getCommunityById,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { communityAccessIn } from "@cohory/entitlements/access";
import { eventOccurrences, eventRsvps, events, memberships, users } from "@cohory/db/schema";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";

import type { CalendarRepository, CalendarStore } from "./repository";

function likeRoot(root: string): string {
  return `${root.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`;
}

function createStore(queries: ScopedQueries): CalendarStore {
  const { tx, where, values } = queries;
  async function first<T>(rows: Promise<T[]>): Promise<T | null> {
    return (await rows)[0] ?? null;
  }

  async function required<T>(rows: Promise<T[]>): Promise<T> {
    const row = (await rows)[0];
    if (!row) {
      throw new Error("write returned no row");
    }
    return row;
  }

  function occurrenceQuery(viewerId: string | null, ...conditions: (SQL | undefined)[]) {
    const viewerRsvp = viewerId
      ? sql<"going" | "not_going" | null>`(select ${eventRsvps.status} from ${eventRsvps}
          where ${eventRsvps.occurrenceId} = ${eventOccurrences.id}
          and ${eventRsvps.userId} = ${viewerId})`
      : sql<null>`null`;
    return tx
      .select({
        occurrence: eventOccurrences,
        event: events,
        viewerRsvp,
        goingCount: sql<number>`(select count(*) from ${eventRsvps}
          join ${memberships} on ${memberships.communityId} = ${eventRsvps.communityId}
            and ${memberships.userId} = ${eventRsvps.userId}
            and ${memberships.status} = 'active'
          where ${eventRsvps.occurrenceId} = ${eventOccurrences.id}
          and ${eventRsvps.status} = 'going')`.mapWith(Number),
      })
      .from(eventOccurrences)
      .innerJoin(events, eq(events.id, eventOccurrences.eventId))
      .where(where(eventOccurrences, ...conditions));
  }

  return {
    findAccess(userId, now) {
      return communityAccessIn(queries, userId, now);
    },

    async enableManagement() {
      await setRlsFlag(tx, "calendar_manager");
    },

    async eventSlugsLike(root) {
      const found = await tx
        .select({ slug: events.slug })
        .from(events)
        .where(
          where(events, or(eq(events.slug, root), sql`${events.slug} like ${likeRoot(root)}`)),
        );
      return found.map((row) => row.slug);
    },

    insertEvent(event) {
      return first(tx.insert(events).values(values(event)).onConflictDoNothing().returning());
    },

    updateEvent(eventId, patch) {
      return required(
        tx
          .update(events)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(events, eq(events.id, eventId)))
          .returning(),
      );
    },

    async deleteEvent(eventId) {
      await tx.delete(events).where(where(events, eq(events.id, eventId)));
    },

    findEventBySlug(slug) {
      return first(
        tx
          .select()
          .from(events)
          .where(where(events, eq(events.slug, slug)))
          .limit(1),
      );
    },

    findEventById(eventId) {
      return first(
        tx
          .select()
          .from(events)
          .where(where(events, eq(events.id, eventId)))
          .limit(1),
      );
    },

    listWeeklyEvents() {
      return tx
        .select()
        .from(events)
        .where(where(events, eq(events.recurrence, "weekly")));
    },

    listEventOccurrences(eventId) {
      return tx
        .select()
        .from(eventOccurrences)
        .where(where(eventOccurrences, eq(eventOccurrences.eventId, eventId)))
        .orderBy(asc(eventOccurrences.startsAt));
    },

    async insertOccurrences(occurrences) {
      if (occurrences.length === 0) {
        return 0;
      }
      const inserted = await tx
        .insert(eventOccurrences)
        .values(occurrences.map((occurrence) => values({ ...occurrence })))
        .onConflictDoNothing()
        .returning({ id: eventOccurrences.id });
      return inserted.length;
    },

    async deleteOccurrences(occurrenceIds) {
      if (occurrenceIds.length === 0) {
        return;
      }
      await tx
        .delete(eventOccurrences)
        .where(where(eventOccurrences, inArray(eventOccurrences.id, [...occurrenceIds])));
    },

    async retimeOccurrences(retimes) {
      if (retimes.length === 0) {
        return;
      }
      // Moving rows one by one can briefly put two of them on the same start, which the unique
      // index rejects, so every moved row first steps far out of the way.
      await tx
        .update(eventOccurrences)
        .set({
          startsAt: sql`${eventOccurrences.startsAt} + interval '1000 years'`,
          endsAt: sql`${eventOccurrences.endsAt} + interval '1000 years'`,
        })
        .where(
          where(
            eventOccurrences,
            inArray(
              eventOccurrences.id,
              retimes.map((retime) => retime.id),
            ),
          ),
        );
      for (const { id, startsAt, endsAt } of retimes) {
        await tx
          .update(eventOccurrences)
          .set({ startsAt, endsAt })
          .where(where(eventOccurrences, eq(eventOccurrences.id, id)));
      }
    },

    async setOccurrenceCanceled(occurrenceId, canceledAt) {
      await tx
        .update(eventOccurrences)
        .set({ canceledAt })
        .where(where(eventOccurrences, eq(eventOccurrences.id, occurrenceId)));
    },

    findOccurrence(occurrenceId, viewerId) {
      return first(occurrenceQuery(viewerId, eq(eventOccurrences.id, occurrenceId)).limit(1));
    },

    listOccurrences({ from, to }, viewerId) {
      return occurrenceQuery(
        viewerId,
        lt(eventOccurrences.startsAt, to),
        gt(eventOccurrences.endsAt, from),
      )
        .orderBy(asc(eventOccurrences.startsAt), asc(eventOccurrences.id))
        .limit(1000);
    },

    findNextOccurrence(from, until) {
      return first(
        occurrenceQuery(
          null,
          gte(eventOccurrences.startsAt, from),
          lt(eventOccurrences.startsAt, until),
          isNull(eventOccurrences.canceledAt),
        )
          .orderBy(asc(eventOccurrences.startsAt), asc(eventOccurrences.id))
          .limit(1),
      );
    },

    listEventUpcoming(eventId, now, limit, viewerId) {
      return occurrenceQuery(
        viewerId,
        eq(eventOccurrences.eventId, eventId),
        gt(eventOccurrences.endsAt, now),
      )
        .orderBy(asc(eventOccurrences.startsAt))
        .limit(limit);
    },

    listGoing(userId, now, limit) {
      return occurrenceQuery(
        userId,
        gt(eventOccurrences.endsAt, now),
        isNull(eventOccurrences.canceledAt),
        sql`exists (select 1 from ${eventRsvps}
            where ${eventRsvps.occurrenceId} = ${eventOccurrences.id}
            and ${eventRsvps.userId} = ${userId}
            and ${eventRsvps.status} = 'going')`,
      )
        .orderBy(asc(eventOccurrences.startsAt))
        .limit(limit);
    },

    async upsertRsvp(occurrenceId, userId, status) {
      await tx
        .insert(eventRsvps)
        .values(values({ occurrenceId, userId, status }))
        .onConflictDoUpdate({
          target: [eventRsvps.occurrenceId, eventRsvps.userId],
          set: { status, updatedAt: new Date() },
        });
    },

    listGoingPeople(occurrenceId, limit) {
      return tx
        .select({
          userId: users.id,
          name: users.name,
          username: sql<string | null>`${users.username}::text`,
          image: users.image,
          respondedAt: eventRsvps.updatedAt,
        })
        .from(eventRsvps)
        .innerJoin(users, eq(users.id, eventRsvps.userId))
        .innerJoin(
          memberships,
          and(
            eq(memberships.communityId, eventRsvps.communityId),
            eq(memberships.userId, eventRsvps.userId),
            eq(memberships.status, "active"),
          ),
        )
        .where(
          where(
            eventRsvps,
            eq(eventRsvps.occurrenceId, occurrenceId),
            eq(eventRsvps.status, "going"),
          ),
        )
        .orderBy(asc(eventRsvps.updatedAt), asc(users.id))
        .limit(limit);
    },

    async listGoingFaces(occurrenceIds, perOccurrence) {
      if (occurrenceIds.length === 0) {
        return [];
      }
      const ranked = tx
        .select({
          occurrenceId: eventRsvps.occurrenceId,
          userId: users.id,
          name: users.name,
          image: users.image,
          rank: sql<number>`row_number() over (partition by ${eventRsvps.occurrenceId}
            order by ${eventRsvps.updatedAt}, ${users.id})`.as("rank"),
        })
        .from(eventRsvps)
        .innerJoin(users, eq(users.id, eventRsvps.userId))
        .innerJoin(
          memberships,
          and(
            eq(memberships.communityId, eventRsvps.communityId),
            eq(memberships.userId, eventRsvps.userId),
            eq(memberships.status, "active"),
          ),
        )
        .where(
          where(
            eventRsvps,
            inArray(eventRsvps.occurrenceId, [...occurrenceIds]),
            eq(eventRsvps.status, "going"),
          ),
        )
        .as("ranked");
      return tx
        .select({
          occurrenceId: ranked.occurrenceId,
          userId: ranked.userId,
          name: ranked.name,
          image: ranked.image,
        })
        .from(ranked)
        .where(lte(ranked.rank, perOccurrence))
        .orderBy(asc(ranked.occurrenceId), asc(ranked.rank));
    },

    async listGoingUsers(occurrenceIds) {
      if (occurrenceIds.length === 0) {
        return [];
      }
      return tx
        .select({
          occurrenceId: eventRsvps.occurrenceId,
          userId: eventRsvps.userId,
          startsAt: eventOccurrences.startsAt,
        })
        .from(eventRsvps)
        .innerJoin(eventOccurrences, eq(eventOccurrences.id, eventRsvps.occurrenceId))
        .innerJoin(
          memberships,
          and(
            eq(memberships.communityId, eventRsvps.communityId),
            eq(memberships.userId, eventRsvps.userId),
            eq(memberships.status, "active"),
          ),
        )
        .where(
          where(
            eventRsvps,
            inArray(eventRsvps.occurrenceId, [...occurrenceIds]),
            eq(eventRsvps.status, "going"),
            isNull(eventOccurrences.canceledAt),
          ),
        )
        .orderBy(asc(eventRsvps.userId), asc(eventOccurrences.startsAt));
    },

    async listMemberRecipients(userIds) {
      if (userIds.length === 0) {
        return [];
      }
      return tx
        .select({ userId: users.id, email: users.email, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          where(
            memberships,
            inArray(memberships.userId, [...userIds]),
            eq(memberships.status, "active"),
            eq(users.emailVerified, true),
            isNull(users.deletionScheduledFor),
            isNull(users.erasedAt),
          ),
        );
    },

    async listGoingRecipients(occurrenceIds) {
      if (occurrenceIds.length === 0) {
        return [];
      }
      return tx
        .select({
          occurrenceId: eventRsvps.occurrenceId,
          userId: users.id,
          email: users.email,
          name: users.name,
          startsAt: eventOccurrences.startsAt,
        })
        .from(eventRsvps)
        .innerJoin(eventOccurrences, eq(eventOccurrences.id, eventRsvps.occurrenceId))
        .innerJoin(users, eq(users.id, eventRsvps.userId))
        .innerJoin(
          memberships,
          and(
            eq(memberships.communityId, eventRsvps.communityId),
            eq(memberships.userId, eventRsvps.userId),
            eq(memberships.status, "active"),
          ),
        )
        .where(
          where(
            eventRsvps,
            inArray(eventRsvps.occurrenceId, [...occurrenceIds]),
            eq(eventRsvps.status, "going"),
            eq(users.emailVerified, true),
            isNull(users.deletionScheduledFor),
            isNull(users.erasedAt),
          ),
        )
        .orderBy(asc(eventOccurrences.startsAt), asc(users.id));
    },

    async claimReminders(occurrenceIds, at) {
      if (occurrenceIds.length === 0) {
        return [];
      }
      const claimed = await tx
        .update(eventRsvps)
        .set({ reminderSentAt: at })
        .where(
          where(
            eventRsvps,
            inArray(eventRsvps.occurrenceId, [...occurrenceIds]),
            eq(eventRsvps.status, "going"),
            isNull(eventRsvps.reminderSentAt),
            sql`exists (select 1 from ${eventOccurrences}
              where ${eventOccurrences.id} = ${eventRsvps.occurrenceId}
              and ${eventOccurrences.canceledAt} is null)`,
            sql`exists (select 1 from ${memberships}
              where ${memberships.communityId} = ${eventRsvps.communityId}
              and ${memberships.userId} = ${eventRsvps.userId}
              and ${memberships.status} = 'active')`,
            sql`exists (select 1 from ${users}
              where ${users.id} = ${eventRsvps.userId}
              and ${users.emailVerified}
              and ${users.deletionScheduledFor} is null
              and ${users.erasedAt} is null)`,
          ),
        )
        .returning({ occurrenceId: eventRsvps.occurrenceId, userId: eventRsvps.userId });
      if (claimed.length === 0) {
        return [];
      }
      const details = await tx
        .select({
          occurrenceId: eventOccurrences.id,
          eventSlug: events.slug,
          title: events.title,
          timeZone: events.timeZone,
          startsAt: eventOccurrences.startsAt,
          location: events.location,
        })
        .from(eventOccurrences)
        .innerJoin(events, eq(events.id, eventOccurrences.eventId))
        .where(
          where(
            eventOccurrences,
            inArray(eventOccurrences.id, [...new Set(claimed.map((row) => row.occurrenceId))]),
          ),
        );
      const recipients = await tx
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(inArray(users.id, [...new Set(claimed.map((row) => row.userId))]));
      const byOccurrence = new Map(details.map((row) => [row.occurrenceId, row]));
      const byUser = new Map(recipients.map((row) => [row.id, row]));
      return claimed.flatMap((row) => {
        const detail = byOccurrence.get(row.occurrenceId);
        const recipient = byUser.get(row.userId);
        return detail && recipient
          ? [{ ...detail, userId: row.userId, email: recipient.email, name: recipient.name }]
          : [];
      });
    },

    async clearReminders(occurrenceIds, sentBefore) {
      if (occurrenceIds.length === 0) {
        return;
      }
      await tx
        .update(eventRsvps)
        .set({ reminderSentAt: null })
        .where(
          where(
            eventRsvps,
            inArray(eventRsvps.occurrenceId, [...occurrenceIds]),
            lt(eventRsvps.reminderSentAt, sentBefore),
          ),
        );
    },

    async releaseReminder(occurrenceId, userId, at) {
      await tx
        .update(eventRsvps)
        .set({ reminderSentAt: null })
        .where(
          where(
            eventRsvps,
            eq(eventRsvps.occurrenceId, occurrenceId),
            eq(eventRsvps.userId, userId),
            eq(eventRsvps.reminderSentAt, at),
          ),
        );
    },
  };
}

export function createPostgresCalendarRepository(db: Database): CalendarRepository {
  async function scan<T>(fn: (tx: ScopedQueries["tx"]) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await setRlsFlag(tx, "calendar_jobs");
      return fn(tx);
    });
  }

  return {
    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? {
            id: community.id,
            slug: community.slug,
            name: community.name,
            appearance: community.appearance,
            privacy: community.privacy,
            archivedAt: community.archivedAt,
          }
        : null;
    },

    inCommunity(communityId, userId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        if (userId) {
          await setRlsValue(queries.tx, "user_id", userId);
        }
        return fn(createStore(queries));
      });
    },

    inCommunityAsJob(communityId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        await setRlsFlag(queries.tx, "calendar_jobs");
        await setRlsFlag(queries.tx, "calendar_manager");
        return fn(createStore(queries));
      });
    },

    dueOccurrences(from, to) {
      return scan(async (tx) => {
        const found = await tx
          .select({ communityId: eventOccurrences.communityId, occurrenceId: eventOccurrences.id })
          .from(eventOccurrences)
          .where(
            and(
              gte(eventOccurrences.startsAt, from),
              lt(eventOccurrences.startsAt, to),
              isNull(eventOccurrences.canceledAt),
            ),
          )
          .orderBy(asc(eventOccurrences.startsAt));
        return found.map((row) => ({
          communityId: communityIdSchema.parse(row.communityId),
          occurrenceId: row.occurrenceId,
        }));
      });
    },

    communitiesWithSeries(now) {
      return scan(async (tx) => {
        const found = await tx
          .selectDistinct({ communityId: eventOccurrences.communityId })
          .from(eventOccurrences)
          .where(gt(eventOccurrences.endsAt, now));
        return found.map((row) => communityIdSchema.parse(row.communityId));
      });
    },
  };
}
