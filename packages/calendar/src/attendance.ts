import { runInCommunity, withCommunity, type CommunityId, type Database } from "@cohory/db";
import { eventOccurrences, eventRsvps } from "@cohory/db/schema";
import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

export interface Attendance {
  readonly userId: string;
  readonly occurrenceId: string;
  readonly endedAt: Date;
}

// No attendance is recorded, so a going RSVP on an occurrence that ended and was not
// cancelled counts as attending. A deleted event has no occurrences left to count.
export function attendedOccurrencesBetween(
  db: Database,
  communityId: CommunityId,
  after: Date,
  until: Date,
): Promise<Attendance[]> {
  return runInCommunity(withCommunity(db, communityId), ({ tx, where }) =>
    tx
      .select({
        userId: eventRsvps.userId,
        occurrenceId: eventRsvps.occurrenceId,
        endedAt: eventOccurrences.endsAt,
      })
      .from(eventRsvps)
      .innerJoin(
        eventOccurrences,
        and(
          eq(eventOccurrences.id, eventRsvps.occurrenceId),
          eq(eventOccurrences.communityId, eventRsvps.communityId),
        ),
      )
      .where(
        where(
          eventRsvps,
          eq(eventRsvps.status, "going"),
          isNull(eventOccurrences.canceledAt),
          gt(eventOccurrences.endsAt, after),
          lte(eventOccurrences.endsAt, until),
        ),
      )
      .orderBy(asc(eventOccurrences.endsAt), asc(eventRsvps.userId)),
  );
}
