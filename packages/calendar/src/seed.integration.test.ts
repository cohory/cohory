import { getCommunityBySlug } from "@cohory/db";
import { eventOccurrences, events } from "@cohory/db/schema";
import { devSeed, seedDevData } from "@cohory/db/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { devSeriesSlug, seedDevEvents } from "./seed";
import { openTestDb } from "./test/fixtures";
import { toWallClock } from "./wall-clock";

const admin = openTestDb();

afterAll(async () => {
  await admin.close();
});

describe("calendar dev seed", () => {
  it("creates a weekly Office hours series across the clock change and a Creator onboarding event, once", async () => {
    const now = new Date("2026-10-18T10:00:00Z");
    await seedDevData(admin.db);
    await seedDevEvents(admin.db, now);
    const again = await seedDevEvents(admin.db, now);
    const community = await getCommunityBySlug(admin.db, devSeed.communitySlug);
    if (!community) throw new Error("no dev community");
    const [series] = await admin.db
      .select()
      .from(events)
      .where(and(eq(events.communityId, community.id), eq(events.slug, devSeriesSlug)));
    if (!series) throw new Error("no series");
    const occurrences = await admin.db
      .select({ startsAt: eventOccurrences.startsAt })
      .from(eventOccurrences)
      .where(eq(eventOccurrences.eventId, series.id));
    const offsets = new Set(occurrences.map((o) => o.startsAt.getUTCHours()));

    expect(again.eventsCreated).toBe(0);
    expect(occurrences.every((o) => toWallClock(o.startsAt, "Europe/Berlin").hour === 17)).toBe(
      true,
    );
    expect([...offsets].sort()).toEqual([15, 16]);
  });
});
