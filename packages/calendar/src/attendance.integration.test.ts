import type { Database } from "@cohory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attendedOccurrencesBetween } from "./attendance";
import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarService } from "./service";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";
import { openProbeDb } from "./test/probe";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const created = new Date("2026-10-01T08:00:00.000Z");
const dayMs = 86_400_000;

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function weeklyCall() {
  const communityId = await insertCommunity(admin.db);
  const owner = user(await insertMember(admin.db, communityId, "owner"));
  const service = createCalendarService({
    repo: createPostgresCalendarRepository(probe.db),
    now: () => created,
  });
  await service.createEvent(owner, communityId, {
    title: "Weekly call",
    startsAtLocal: "2026-10-02T10:00",
    timeZone: "UTC",
    durationMinutes: 60,
    recurrence: "weekly",
    location: "https://meet.example.com/weekly",
  });
  const occurrences = await service.listOccurrences(owner, communityId, {
    from: created,
    to: new Date(created.getTime() + 15 * dayMs),
  });
  return { communityId, owner, service, occurrences };
}

describe("attendedOccurrencesBetween", () => {
  it("counts a going RSVP once its occurrence has ended", async () => {
    const { communityId, service, occurrences } = await weeklyCall();
    const [first, second] = occurrences;
    if (!first || !second) throw new Error("expected two occurrences");
    const going = await insertMember(admin.db, communityId);
    const notGoing = await insertMember(admin.db, communityId);
    await service.rsvp(user(going), communityId, first.id, { status: "going" });
    await service.rsvp(user(going), communityId, second.id, { status: "going" });
    await service.rsvp(user(notGoing), communityId, first.id, { status: "not_going" });

    const attended = await attendedOccurrencesBetween(
      probe.db,
      communityId,
      created,
      new Date(first.endsAt.getTime() + 1),
    );

    expect(attended).toEqual([{ userId: going, occurrenceId: first.id, endedAt: first.endsAt }]);
  });

  it("leaves out a cancelled occurrence", async () => {
    const { communityId, owner, service, occurrences } = await weeklyCall();
    const [first] = occurrences;
    if (!first) throw new Error("expected an occurrence");
    const going = await insertMember(admin.db, communityId);
    await service.rsvp(user(going), communityId, first.id, { status: "going" });
    await service.cancelOccurrence(owner, communityId, first.id);

    const attended = await attendedOccurrencesBetween(
      probe.db,
      communityId,
      created,
      new Date(first.endsAt.getTime() + dayMs),
    );

    expect(attended).toEqual([]);
  });

  it("reads only the given community", async () => {
    const { communityId, service, occurrences } = await weeklyCall();
    const [first] = occurrences;
    if (!first) throw new Error("expected an occurrence");
    const going = await insertMember(admin.db, communityId);
    await service.rsvp(user(going), communityId, first.id, { status: "going" });
    const other = await insertCommunity(admin.db);

    const attended = await attendedOccurrencesBetween(
      probe.db,
      other,
      created,
      new Date(first.endsAt.getTime() + dayMs),
    );

    expect(attended).toEqual([]);
  });
});
