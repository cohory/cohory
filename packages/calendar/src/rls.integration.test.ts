import { newId, type Database } from "@cohory/db";
import { eventOccurrences, eventRsvps, events } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarService } from "./service";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";
import { openProbeDb } from "./test/probe";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const now = new Date("2026-10-18T10:00:00Z");

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function asProbe<T>(
  settings: { community?: string; user?: string; manager?: boolean; jobs?: boolean },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return probe.db.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.user_id", settings.user);
    await set("app.calendar_manager", settings.manager ? "on" : undefined);
    await set("app.calendar_jobs", settings.jobs ? "on" : undefined);
    return fn(tx);
  });
}

const weekly = {
  title: "Under RLS",
  startsAtLocal: "2026-10-18T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly" as const,
  recurrenceUntil: "2026-11-08",
  location: "https://meet.example.com/rls",
};
const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("calendar row level security", () => {
  it("is enabled and forced on every calendar table", async () => {
    const result = await admin.db.execute<{ relname: string; enabled: boolean; forced: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname in ('events', 'event_occurrences', 'event_rsvps') order by relname`,
    );

    expect(result.rows).toEqual(
      ["event_occurrences", "event_rsvps", "events"].map((relname) => ({
        relname,
        enabled: true,
        forced: true,
      })),
    );
  });

  it("runs the calendar service through a role without bypass", async () => {
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const memberId = await insertMember(admin.db, communityId, "member");
    const service = createCalendarService({
      repo: createPostgresCalendarRepository(probe.db),
      now: () => now,
    });

    const event = await service.createEvent(owner, communityId, weekly);
    const list = await service.listOccurrences(user(memberId), communityId, range);
    const [first, second] = list;
    if (!first || !second) throw new Error("no occurrence");
    const rsvp = await service.rsvp(user(memberId), communityId, first.id, { status: "going" });
    await service.cancelOccurrence(owner, communityId, second.id);
    const afterCancel = await service.listOccurrences(user(memberId), communityId, range);
    await service.updateEvent(owner, communityId, event.slug, { title: "Renamed" });

    expect(list).toHaveLength(4);
    expect(rsvp.goingCount).toBe(1);
    expect(afterCancel.find((o) => o.id === second.id)?.canceledAt).toEqual(now);

    const scoped = await asProbe({ community: communityId }, (tx) =>
      tx.select({ id: eventOccurrences.id }).from(eventOccurrences),
    );
    const unscoped = await asProbe({}, (tx) => tx.select({ id: events.id }).from(events));
    const rsvpsUnscoped = await asProbe({ user: memberId }, (tx) =>
      tx.select({ userId: eventRsvps.userId }).from(eventRsvps),
    );
    const scanned = await asProbe({ jobs: true }, (tx) =>
      tx
        .select({ id: eventOccurrences.id })
        .from(eventOccurrences)
        .where(sql`${eventOccurrences.communityId} = ${communityId}`),
    );
    const eventsWhileScanning = await asProbe({ jobs: true }, (tx) =>
      tx.select({ id: events.id }).from(events),
    );

    expect(scoped).toHaveLength(4);
    expect(unscoped).toEqual([]);
    expect(rsvpsUnscoped).toEqual([]);
    expect(scanned).toHaveLength(4);
    expect(eventsWhileScanning).toEqual([]);
  });

  it("refuses event writes without the manager setting and RSVPs for someone else", async () => {
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const member = await insertMember(admin.db, communityId, "member");
    const other = await insertMember(admin.db, communityId, "member");
    const service = createCalendarService({
      repo: createPostgresCalendarRepository(admin.db),
      now: () => now,
    });
    await service.createEvent(owner, communityId, weekly);
    const [first] = await service.listOccurrences(owner, communityId, range);
    if (!first) throw new Error("no occurrence");

    await expect(
      asProbe({ community: communityId, user: member }, (tx) =>
        tx.insert(events).values({
          id: newId(),
          communityId,
          slug: "sneaky",
          title: "Sneaky",
          startsAtLocal: "2026-10-20 10:00:00",
          timeZone: "UTC",
          durationMinutes: 30,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      asProbe({ community: communityId, user: member }, (tx) =>
        tx.insert(eventRsvps).values({
          communityId,
          occurrenceId: first.id,
          userId: other,
          status: "going",
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    const updated = await asProbe({ community: communityId, user: member }, (tx) =>
      tx
        .update(eventOccurrences)
        .set({ canceledAt: now })
        .where(sql`${eventOccurrences.id} = ${first.id}`)
        .returning({ id: eventOccurrences.id }),
    );
    expect(updated).toEqual([]);
  });
});
