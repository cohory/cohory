import { eventOccurrences, eventRsvps, events } from "@cohory/db/schema";

import { actAs } from "../scope";
import { date, dateOrNull, isHttpsUrl, type RestoreContext } from "./restore-context";

export async function restoreEvents(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, slugs, user } = ctx;
  await phase(
    "events",
    records.events,
    (row) => row.id,
    async (tx, items) => {
      const values = items.map(({ row, id }) => ({
        id,
        communityId: target,
        slug: slugs.event(row.id) ?? row.slug,
        title: row.title,
        description: row.description,
        startsAtLocal: row.startsAtLocal.replace("T", " "),
        timeZone: row.timeZone,
        durationMinutes: row.durationMinutes,
        recurrence: row.recurrence,
        recurrenceUntil: row.recurrenceUntil,
        location: row.location,
        recordingUrl: isHttpsUrl(row.recordingUrl) ? row.recordingUrl : null,
        createdAt: date(row.createdAt),
      }));
      if (values.length > 0) {
        await tx.insert(events).values(values);
      }
      return new Set<string>();
    },
  );

  await phase(
    "event_occurrences",
    records.event_occurrences,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const eventId = map.get("events", row.eventId);
        if (!eventId) {
          skips.add("event_occurrences", row.id, "The event is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          eventId,
          startsAt: date(row.startsAt),
          endsAt: date(row.endsAt),
          canceledAt: dateOrNull(row.canceledAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(eventOccurrences).values(values).onConflictDoNothing();
      }
      return skipped;
    },
  );

  await phase(
    "event_rsvps",
    records.event_rsvps,
    (row) => `${row.occurrenceId}:${row.userId}`,
    async (tx, items) => {
      const skipped = new Set<string>();
      const byUser = new Map<string, (typeof eventRsvps.$inferInsert)[]>();
      for (const { row } of items) {
        const sourceKey = `${row.occurrenceId}:${row.userId}`;
        const occurrenceId = map.get("event_occurrences", row.occurrenceId);
        const userId = user(row.userId);
        if (!occurrenceId || !userId) {
          skips.add("event_rsvps", sourceKey, "The event or the person is not in the archive.");
          skipped.add(sourceKey);
          continue;
        }
        const list = byUser.get(userId) ?? [];
        list.push({
          communityId: target,
          occurrenceId,
          userId,
          status: row.status,
          reminderSentAt: dateOrNull(row.reminderSentAt),
        });
        byUser.set(userId, list);
      }
      for (const [userId, values] of byUser) {
        await actAs(tx, userId);
        await tx.insert(eventRsvps).values(values).onConflictDoNothing();
      }
      return skipped;
    },
  );
}
