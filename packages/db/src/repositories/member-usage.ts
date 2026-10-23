import { count, eq, isNotNull, isNull, lte, or } from "drizzle-orm";

import { eventOccurrences, eventRsvps, lessonProgress, posts } from "../schema";
import type { ScopedQueries } from "../tenancy/scope";

export interface MemberUsage {
  readonly lessonsDone: number;
  readonly eventsAttended: number;
  readonly posts: number;
}

export async function memberUsageIn(
  { tx, where }: Pick<ScopedQueries, "tx" | "where">,
  userId: string,
  now: Date,
): Promise<MemberUsage> {
  const [lessons, events, written] = await Promise.all([
    tx
      .select({ value: count() })
      .from(lessonProgress)
      .where(
        where(
          lessonProgress,
          eq(lessonProgress.userId, userId),
          isNotNull(lessonProgress.completedAt),
        ),
      ),
    tx
      .select({ value: count() })
      .from(eventRsvps)
      .innerJoin(eventOccurrences, eq(eventOccurrences.id, eventRsvps.occurrenceId))
      .where(
        where(
          eventRsvps,
          eq(eventRsvps.userId, userId),
          eq(eventRsvps.status, "going"),
          isNull(eventOccurrences.canceledAt),
          lte(eventOccurrences.startsAt, now),
        ),
      ),
    tx
      .select({ value: count() })
      .from(posts)
      .where(
        where(
          posts,
          eq(posts.authorId, userId),
          isNull(posts.deletedAt),
          or(isNull(posts.scheduledAt), lte(posts.scheduledAt, now)),
        ),
      ),
  ]);
  return {
    lessonsDone: lessons[0]?.value ?? 0,
    eventsAttended: events[0]?.value ?? 0,
    posts: written[0]?.value ?? 0,
  };
}
