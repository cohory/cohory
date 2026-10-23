import { ForbiddenError } from "@cohory/authz";
import { CommunityArchivedError } from "@cohory/communities/archive";
import { createRateLimiter, rateLimitDefaults, RateLimitedError } from "@cohory/rate-limit";
import { communities, eventOccurrences, eventRsvps } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CalendarNotFoundError, CalendarValidationError } from "./errors";
import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarService } from "./service";
import type { TimeChangeJobInput } from "./time-change";
import { insertCommunity, insertMember, insertUser, openTestDb, user } from "./test/fixtures";

const admin = openTestDb();
let clock = new Date("2026-10-18T10:00:00Z");
let queued: TimeChangeJobInput[] = [];
const service = createCalendarService({
  repo: createPostgresCalendarRepository(admin.db),
  appUrl: "http://localhost:3000/",
  now: () => clock,
  queue: {
    scheduleTimeChange: (payload) => {
      queued.push(payload);
      return Promise.resolve();
    },
    scheduleNotice: () => Promise.resolve(),
  },
});

beforeEach(() => {
  queued = [];
});

afterAll(async () => {
  await admin.close();
});

const weekly = {
  title: "Weekly call",
  description: "Bring questions.",
  startsAtLocal: "2026-10-18T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly" as const,
  recurrenceUntil: "2026-11-08",
  location: "https://meet.example.com/weekly",
};

const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };

async function setup(privacy: "public" | "private" = "private") {
  const communityId = await insertCommunity(admin.db, privacy);
  const owner = await insertMember(admin.db, communityId, "owner");
  const member = await insertMember(admin.db, communityId, "member");
  return { communityId, owner: user(owner), member: user(member), memberId: member };
}

describe("calendar service", () => {
  it("creates a weekly series whose occurrences stay at 18:00 Berlin time across the change", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();

    const event = await service.createEvent(owner, communityId, weekly);
    const list = await service.listOccurrences(member, communityId, range);

    expect(event.slug).toBe("weekly-call");
    expect(list.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-10-18T16:00:00.000Z",
      "2026-10-25T17:00:00.000Z",
      "2026-11-01T17:00:00.000Z",
      "2026-11-08T17:00:00.000Z",
    ]);
    expect(list[0]?.event).toMatchObject({
      slug: "weekly-call",
      startsAtLocal: "2026-10-18T18:00",
    });
  });

  it("refuses event writes from members and invalid zones or end dates", async () => {
    const { communityId, owner, member } = await setup();

    await expect(service.createEvent(member, communityId, weekly)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.createEvent(owner, communityId, { ...weekly, timeZone: "Mars/Olympus" }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
    await expect(
      service.createEvent(owner, communityId, { ...weekly, recurrenceUntil: "2026-10-01" }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
    await expect(
      service.createEvent(owner, communityId, { ...weekly, recurrenceUntil: "2026-10-18" }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
    await expect(
      service.createEvent(owner, communityId, { ...weekly, durationMinutes: 4 }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it("records an RSVP idempotently and counts who is going", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member, memberId } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const [first] = await service.listOccurrences(member, communityId, range);
    if (!first) throw new Error("no occurrence");

    await service.rsvp(member, communityId, first.id, { status: "going" });
    const again = await service.rsvp(member, communityId, first.id, { status: "going" });
    await service.rsvp(owner, communityId, first.id, { status: "going" });
    const rows = await admin.db
      .select()
      .from(eventRsvps)
      .where(eq(eventRsvps.occurrenceId, first.id));
    const [seen] = await service.listOccurrences(member, communityId, range);
    const changed = await service.rsvp(member, communityId, first.id, { status: "not_going" });

    expect(again).toEqual({ occurrenceId: first.id, status: "going", goingCount: 1 });
    expect(rows.filter((row) => row.userId === memberId)).toHaveLength(1);
    expect(seen).toMatchObject({ viewerRsvp: "going", goingCount: 2 });
    expect(changed.goingCount).toBe(1);
  });

  it("lists who is going to owners and admins only", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member, memberId } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const [first] = await service.listOccurrences(member, communityId, range);
    if (!first) throw new Error("no occurrence");
    await service.rsvp(member, communityId, first.id, { status: "going" });
    const declined = user(await insertMember(admin.db, communityId, "member"));
    await service.rsvp(declined, communityId, first.id, { status: "not_going" });

    const list = await service.listOccurrenceRsvps(owner, communityId, first.id);

    expect(list.occurrenceId).toBe(first.id);
    expect(list.goingCount).toBe(1);
    expect(list.going.map((person) => person.userId)).toEqual([memberId]);
    await expect(service.listOccurrenceRsvps(member, communityId, first.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await setup();
    await expect(
      service.listOccurrenceRsvps(other.owner, other.communityId, first.id),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });

  it("shows a canceled occurrence to members as canceled and keeps its RSVPs", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const [, second] = await service.listOccurrences(member, communityId, range);
    if (!second) throw new Error("no occurrence");
    await service.rsvp(member, communityId, second.id, { status: "going" });

    const canceled = await service.cancelOccurrence(owner, communityId, second.id);
    const memberList = await service.listOccurrences(member, communityId, range);
    const ownerList = await service.listOccurrences(owner, communityId, range);
    const [row] = await admin.db
      .select()
      .from(eventOccurrences)
      .where(eq(eventOccurrences.id, second.id));

    expect(canceled.canceledAt).toEqual(clock);
    expect(memberList.find((o) => o.id === second.id)?.canceledAt).toEqual(clock);
    expect(ownerList.find((o) => o.id === second.id)?.canceledAt).toEqual(clock);
    expect(row?.canceledAt).toEqual(clock);
    const detail = await service.getOccurrence(member, communityId, "weekly-call", second.id);
    expect(detail.canceledAt).toEqual(clock);
    expect(detail.viewerRsvp).toBe("going");
    await expect(
      service.rsvp(member, communityId, second.id, { status: "going" }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
    const upcoming = await service.getUpcomingForViewer(member, communityId);
    expect(upcoming.map((o) => o.id)).not.toContain(second.id);
    await expect(service.cancelOccurrence(member, communityId, second.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await service.uncancelOccurrence(owner, communityId, second.id);
    const restored = await service.listOccurrences(member, communityId, range);
    expect(restored.find((o) => o.id === second.id)?.viewerRsvp).toBe("going");
  });

  it("edits the series, keeping past occurrences and RSVPs on unchanged ones", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const before = await service.listOccurrences(member, communityId, range);
    for (const occurrence of before) {
      await service.rsvp(member, communityId, occurrence.id, { status: "going" });
    }

    clock = new Date("2026-10-26T10:00:00Z");
    await service.updateEvent(owner, communityId, event.slug, { durationMinutes: 90 });
    const longer = await service.listOccurrences(member, communityId, range);
    await service.updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2026-10-18T19:00",
    });
    const moved = await service.listOccurrences(member, communityId, range);

    expect(longer.map((o) => o.id)).toEqual(before.map((o) => o.id));
    expect(longer.every((o) => o.viewerRsvp === "going")).toBe(true);
    expect(longer[2]?.endsAt.toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(moved.map((o) => o.id)).toEqual(before.map((o) => o.id));
    expect(moved.slice(2).map((o) => o.startsAt.toISOString())).toEqual([
      "2026-11-01T18:00:00.000Z",
      "2026-11-08T18:00:00.000Z",
    ]);
    expect(moved.every((o) => o.viewerRsvp === "going")).toBe(true);
  });

  it("keeps RSVPs, canceled dates, and old links when the time and zone of a series change", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const before = await service.listOccurrences(member, communityId, range);
    const [first, second] = before;
    if (!first || !second) throw new Error("no occurrence");
    await service.rsvp(member, communityId, first.id, { status: "going" });
    await service.rsvp(owner, communityId, first.id, { status: "going" });
    await service.cancelOccurrence(owner, communityId, second.id);

    const change = { startsAtLocal: "2026-10-18T19:30", timeZone: "America/New_York" };
    expect(await service.previewEventChange(owner, communityId, event.slug, change)).toEqual({
      moving: 1,
      removing: 0,
    });
    await expect(
      service.previewEventChange(member, communityId, event.slug, change),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await service.updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2026-10-18T19:30",
      timeZone: "America/New_York",
    });
    const after = await service.listOccurrences(member, communityId, range);
    const old = await service.getOccurrence(member, communityId, event.slug, first.id);

    expect(after.map((o) => o.id)).toEqual(before.map((o) => o.id));
    expect(after[0]).toMatchObject({ viewerRsvp: "going", goingCount: 2 });
    expect(after[0]?.startsAt.toISOString()).toBe("2026-10-18T23:30:00.000Z");
    expect(after[1]?.canceledAt).not.toBeNull();
    expect(old.startsAt.toISOString()).toBe("2026-10-18T23:30:00.000Z");
  });

  it("moves every date onto a later start without a clash and keeps the next RSVP", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const before = await service.listOccurrences(member, communityId, range);
    const [first] = before;
    if (!first) throw new Error("no occurrence");
    await service.rsvp(member, communityId, first.id, { status: "going" });

    await service.updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2026-11-01T18:00",
      recurrenceUntil: "2026-11-29",
    });
    const after = await service.listOccurrences(member, communityId, {
      from: range.from,
      to: new Date("2026-12-31T00:00:00Z"),
    });

    expect(after.slice(0, 4).map((o) => o.id)).toEqual(before.map((o) => o.id));
    expect(after.map((o) => o.startsAt.toISOString())).toEqual([
      "2026-11-01T17:00:00.000Z",
      "2026-11-08T17:00:00.000Z",
      "2026-11-15T17:00:00.000Z",
      "2026-11-22T17:00:00.000Z",
      "2026-11-29T17:00:00.000Z",
    ]);
    expect(after[0]?.viewerRsvp).toBe("going");
  });

  it("queues one time change job with the old start of every moved date", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const before = await service.listOccurrences(member, communityId, range);

    await service.updateEvent(owner, communityId, event.slug, { title: "Renamed call" });
    expect(queued).toEqual([]);

    await service.updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2026-10-18T19:00",
    });

    expect(queued).toEqual([
      {
        communityId,
        eventId: event.id,
        editorId: owner.kind === "user" ? owner.userId : null,
        changedAt: clock.toISOString(),
        previousZone: "Europe/Berlin",
        baseline: before.map((o) => ({
          occurrenceId: o.id,
          previousStart: o.startsAt.toISOString(),
        })),
        removals: [],
      },
    ]);
  });

  it("counts and queues the people going to dates a shorter series removes", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member, memberId } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const before = await service.listOccurrences(member, communityId, range);
    const [, , third, fourth] = before;
    if (!third || !fourth) throw new Error("no occurrence");
    await service.rsvp(member, communityId, third.id, { status: "going" });
    await service.rsvp(member, communityId, fourth.id, { status: "going" });
    await service.rsvp(owner, communityId, fourth.id, { status: "going" });
    const change = { recurrenceUntil: "2026-10-25" };

    expect(await service.previewEventChange(owner, communityId, event.slug, change)).toEqual({
      moving: 0,
      removing: 1,
    });
    await service.updateEvent(owner, communityId, event.slug, change);

    expect(queued).toHaveLength(1);
    expect(queued[0]?.baseline).toEqual([]);
    expect(queued[0]?.removals).toEqual([
      {
        userId: memberId,
        starts: [third.startsAt.toISOString(), fourth.startsAt.toISOString()],
        occurrenceIds: [third.id, fourth.id],
      },
    ]);
  });

  it("keeps a saved time change when the job cannot be queued", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner } = await setup();
    const failures: unknown[] = [];
    const offline = createCalendarService({
      repo: createPostgresCalendarRepository(admin.db),
      now: () => clock,
      queue: {
        scheduleTimeChange: () => Promise.reject(new Error("queue down")),
        scheduleNotice: () => Promise.resolve(),
      },
      onQueueError: (error) => {
        failures.push(error);
      },
    });
    const event = await offline.createEvent(owner, communityId, weekly);

    const updated = await offline.updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2026-10-18T19:00",
    });

    expect(updated.startsAtLocal).toBe("2026-10-18T19:00");
    expect(failures).toHaveLength(1);
  });

  it("shows the join link to members only and titles to guests of a public community", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup("public");
    const event = await service.createEvent(owner, communityId, weekly);
    const [first] = await service.listOccurrences(member, communityId, range);
    if (!first) throw new Error("no occurrence");
    const outsider = user(await insertUser(admin.db));

    const asMember = await service.getOccurrence(member, communityId, event.slug, first.id);
    const asGuest = await service.getOccurrence(outsider, communityId, event.slug, first.id);
    const anonymous = await service.getEvent({ kind: "guest" }, communityId, event.slug);

    expect(asMember.event.location).toBe(weekly.location);
    expect(asGuest.event).toMatchObject({
      title: "Weekly call",
      location: null,
      detailsVisible: false,
    });
    expect(anonymous.location).toBeNull();
    await expect(
      service.rsvp(outsider, communityId, first.id, { status: "going" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.icsForEvent(outsider, communityId, event.slug)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.getOccurrence(member, communityId, "other-slug", first.id),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });

  it("lists the viewer's next three occurrences they are going to", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const all = await service.listOccurrences(member, communityId, range);
    for (const occurrence of all) {
      await service.rsvp(member, communityId, occurrence.id, { status: "going" });
    }
    await service.rsvp(member, communityId, all[1]?.id ?? "", { status: "not_going" });

    const upcoming = await service.getUpcomingForViewer(member, communityId);

    expect(upcoming.map((o) => o.id)).toEqual([all[0]?.id, all[2]?.id, all[3]?.id]);
    await expect(
      service.getUpcomingForViewer({ kind: "guest" }, communityId),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });

  it("shows the next two community occurrences to a member who has not said they are going", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const all = await service.listOccurrences(member, communityId, range);
    await service.rsvp(member, communityId, all[0]?.id ?? "", { status: "not_going" });
    await service.cancelOccurrence(owner, communityId, all[1]?.id ?? "");

    const next = await service.getNextForViewer(member, communityId);

    expect(next.map((o) => o.id)).toEqual([all[2]?.id, all[3]?.id]);
    expect(next.map((o) => o.viewerRsvp)).toEqual([null, null]);
  });

  it("shows only the occurrences the member is going to once they said they are going", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const all = await service.listOccurrences(member, communityId, range);
    await service.rsvp(member, communityId, all[2]?.id ?? "", { status: "going" });

    const next = await service.getNextForViewer(member, communityId);

    expect(next.map((o) => o.id)).toEqual([all[2]?.id]);
    await expect(service.getNextForViewer({ kind: "guest" }, communityId)).rejects.toBeInstanceOf(
      CalendarNotFoundError,
    );
  });

  it("deletes an event with its occurrences and builds ics files", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const [first, second] = await service.listOccurrences(member, communityId, range);
    if (!first || !second) throw new Error("no occurrence");
    await service.cancelOccurrence(owner, communityId, second.id);

    const series = await service.icsForEvent(member, communityId, event.slug);
    const single = await service.icsForOccurrence(member, communityId, first.id);

    expect(series.filename).toBe("weekly-call.ics");
    expect(series.content).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261108T225959Z");
    expect(series.content).toContain("EXDATE;TZID=Europe/Berlin:20261025T180000");
    expect(single.filename).toBe("weekly-call-2026-10-18.ics");
    expect(single.content).toContain("DTSTART;TZID=Europe/Berlin:20261018T180000");

    await service.deleteEvent(owner, communityId, event.slug);
    expect(await service.listOccurrences(owner, communityId, range)).toEqual([]);
    await expect(service.getEvent(owner, communityId, event.slug)).rejects.toBeInstanceOf(
      CalendarNotFoundError,
    );
  });

  it("does not reach another community's occurrences", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const a = await setup();
    const b = await setup();
    const event = await service.createEvent(a.owner, a.communityId, weekly);
    const [first] = await service.listOccurrences(a.member, a.communityId, range);
    if (!first) throw new Error("no occurrence");

    await expect(
      service.getOccurrence(b.owner, b.communityId, event.slug, first.id),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
    await expect(
      service.rsvp(b.member, b.communityId, first.id, { status: "going" }),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
    await expect(service.cancelOccurrence(b.owner, b.communityId, first.id)).rejects.toBeInstanceOf(
      CalendarNotFoundError,
    );
    await expect(service.listOccurrences(a.member, b.communityId, range)).rejects.toBeInstanceOf(
      CalendarNotFoundError,
    );
  });

  it("keeps an archived community's calendar readable and rejects every write", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const [first] = await service.listOccurrences(member, communityId, range);
    if (!first) throw new Error("no occurrence");
    await admin.db
      .update(communities)
      .set({ archivedAt: clock })
      .where(eq(communities.id, communityId));

    expect(await service.listOccurrences(member, communityId, range)).toHaveLength(4);
    expect((await service.getEvent(member, communityId, event.slug)).slug).toBe(event.slug);
    const writes = [
      () => service.createEvent(owner, communityId, weekly),
      () => service.updateEvent(owner, communityId, event.slug, { title: "Renamed" }),
      () =>
        service.setRecordingUrl(owner, communityId, event.slug, {
          recordingUrl: "https://video.example.com/1",
        }),
      () => service.cancelOccurrence(owner, communityId, first.id),
      () => service.uncancelOccurrence(owner, communityId, first.id),
      () => service.rsvp(member, communityId, first.id, { status: "going" }),
      () => service.deleteEvent(owner, communityId, event.slug),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(CommunityArchivedError);
    }
  });

  it("limits RSVPs per member", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup();
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, rsvp: { max: 1, windowSeconds: 60 } },
    });
    const limited = createCalendarService({
      repo: createPostgresCalendarRepository(admin.db),
      now: () => clock,
      rateLimit: (rule, userId) => limiter.consume(rule, userId),
    });
    await limited.createEvent(owner, communityId, weekly);
    const [first] = await limited.listOccurrences(member, communityId, range);
    if (!first) throw new Error("no occurrence");

    await limited.rsvp(member, communityId, first.id, { status: "going" });

    await expect(
      limited.rsvp(member, communityId, first.id, { status: "not_going" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      limited.rsvp(owner, communityId, first.id, { status: "going" }),
    ).resolves.toMatchObject({ status: "going" });
  });
});

describe("next event teaser for the About page", () => {
  it("gives visitors of a public community the next title and start, skipping canceled dates", async () => {
    clock = new Date("2026-10-18T16:30:00Z");
    const { communityId, owner, member } = await setup("public");
    await service.createEvent(owner, communityId, weekly);
    const [, second] = await service.listOccurrences(member, communityId, range);
    if (!second) throw new Error("no occurrence");
    await service.cancelOccurrence(owner, communityId, second.id);

    await expect(service.nextEventTeaser({ kind: "guest" }, communityId)).resolves.toEqual({
      kind: "event",
      title: "Weekly call",
      startsAt: new Date("2026-11-01T17:00:00.000Z"),
    });
  });

  it("gives people outside a private community the date only, and members the full teaser", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner, member } = await setup("private");
    await service.createEvent(owner, communityId, weekly);
    const outsider = user(await insertUser(admin.db));

    const date = { kind: "date", date: "2026-10-18" };
    await expect(service.nextEventTeaser({ kind: "guest" }, communityId)).resolves.toEqual(date);
    await expect(service.nextEventTeaser(outsider, communityId)).resolves.toEqual(date);
    await expect(service.nextEventTeaser(member, communityId)).resolves.toMatchObject({
      kind: "event",
      title: "Weekly call",
    });
  });

  it("skips a date that has already started", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId, owner } = await setup("public");
    await service.createEvent(owner, communityId, weekly);
    clock = new Date("2026-10-18T16:30:00Z");

    await expect(service.nextEventTeaser({ kind: "guest" }, communityId)).resolves.toMatchObject({
      kind: "event",
      startsAt: new Date("2026-10-25T17:00:00.000Z"),
    });
  });

  it("returns nothing without an upcoming event and refuses an unknown community", async () => {
    clock = new Date("2026-10-18T10:00:00Z");
    const { communityId } = await setup("public");

    await expect(service.nextEventTeaser({ kind: "guest" }, communityId)).resolves.toBeNull();
    await expect(
      service.nextEventTeaser({ kind: "guest" }, "0192f0a0-0000-7000-8000-00000000dead"),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });
});
