import type { Database } from "@cohory/db";
import type { EmailMessage } from "@cohory/email";
import { eventOccurrences, eventRsvps, memberships, users } from "@cohory/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarJobs } from "./reminders";
import { createCalendarService } from "./service";
import { timeChangeJobPayloadSchema, type TimeChangeJobInput } from "./time-change";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";
import { fakeNotifier, type FakeNotifier } from "./test/notifier";
import { openProbeDb } from "./test/probe";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function scenario(created: Date, startsAtLocal: string) {
  const communityId = await insertCommunity(admin.db);
  const owner = user(await insertMember(admin.db, communityId, "owner"));
  const going = [
    await insertMember(admin.db, communityId),
    await insertMember(admin.db, communityId),
  ];
  const notGoing = await insertMember(admin.db, communityId);
  const service = createCalendarService({
    repo: createPostgresCalendarRepository(probe.db),
    now: () => created,
  });
  const event = await service.createEvent(owner, communityId, {
    title: "Reminder call",
    startsAtLocal,
    timeZone: "Europe/Berlin",
    durationMinutes: 60,
    recurrence: "weekly",
    location: "https://meet.example.com/remind",
  });
  const [first] = await service.listOccurrences(owner, communityId, {
    from: created,
    to: new Date(created.getTime() + 8 * 86_400_000),
  });
  if (!first) throw new Error("no occurrence");
  for (const userId of going) {
    await service.rsvp(user(userId), communityId, first.id, { status: "going" });
  }
  await service.rsvp(user(notGoing), communityId, first.id, { status: "not_going" });
  const emails = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.id, going));
  return { communityId, event, first, going, emails: emails.map((row) => row.email).sort() };
}

describe("calendar.reminders", () => {
  it("sends each going member exactly one reminder under two concurrent runs", async () => {
    const created = new Date("2031-03-03T08:00:00Z");
    const run = new Date("2031-03-03T09:00:00Z");
    const { first, going, emails } = await scenario(created, "2031-03-03T11:00");
    const sent: EmailMessage[] = [];
    const jobs = () =>
      createCalendarJobs({
        notifier: fakeNotifier().notifier,
        repo: createPostgresCalendarRepository(probe.db),
        appUrl: "http://localhost:3000",
        now: () => run,
        send: async (message) => {
          sent.push(message);
        },
      });

    await Promise.all([jobs().sendDueReminders(), jobs().sendDueReminders()]);
    await jobs().sendDueReminders();
    const rows = await admin.db
      .select({ userId: eventRsvps.userId, reminderSentAt: eventRsvps.reminderSentAt })
      .from(eventRsvps)
      .where(eq(eventRsvps.occurrenceId, first.id));

    expect(sent.map((message) => message.to).sort()).toEqual(emails);
    expect(sent[0]?.text).toContain("Monday, March 3, 2031 at 11:00 AM (Europe/Berlin)");
    expect(
      rows
        .filter((row) => row.reminderSentAt !== null)
        .map((row) => row.userId)
        .sort(),
    ).toEqual([...going].sort());
  });

  it("releases the claim when sending fails so a later run retries", async () => {
    const created = new Date("2031-03-10T08:00:00Z");
    const { first, going } = await scenario(created, "2031-03-10T11:00");
    const repo = createPostgresCalendarRepository(probe.db);
    const failing = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo,
      appUrl: "http://localhost:3000",
      now: () => new Date("2031-03-10T09:00:00Z"),
      send: () => Promise.reject(new Error("smtp down")),
    });
    const working = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo,
      appUrl: "http://localhost:3000",
      now: () => new Date("2031-03-10T09:05:00Z"),
      send: async () => undefined,
    });

    expect(await failing.sendDueReminders()).toEqual({ sent: 0, failed: 2 });
    const released = await admin.db
      .select({ reminderSentAt: eventRsvps.reminderSentAt })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.occurrenceId, first.id), inArray(eventRsvps.userId, going)));
    expect(released.every((row) => row.reminderSentAt === null)).toBe(true);
    expect(await working.sendDueReminders()).toEqual({ sent: 2, failed: 0 });
  });

  it("skips canceled occurrences", async () => {
    const created = new Date("2031-03-17T08:00:00Z");
    const { communityId, first } = await scenario(created, "2031-03-17T11:00");
    await admin.db
      .update(eventOccurrences)
      .set({ canceledAt: created })
      .where(and(eq(eventOccurrences.id, first.id), eq(eventOccurrences.communityId, communityId)));
    const sent: EmailMessage[] = [];

    await createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      now: () => new Date("2031-03-17T09:00:00Z"),
      send: async (message) => {
        sent.push(message);
      },
    }).sendDueReminders();

    expect(sent).toEqual([]);
  });
});

describe("calendar.reminders for people who are no longer members", () => {
  it.each(["banned", "removed"] as const)(
    "sends no reminder to a %s member and leaves them out of the going count",
    async (status) => {
      const created = new Date(
        status === "banned" ? "2031-04-07T08:00:00Z" : "2031-04-14T08:00:00Z",
      );
      const startsAtLocal = status === "banned" ? "2031-04-07T12:00" : "2031-04-14T12:00";
      const { communityId, first, going, emails } = await scenario(created, startsAtLocal);
      const [former, current] = going;
      if (!former || !current) throw new Error("no attendees");
      await admin.db
        .update(memberships)
        .set({ status, role: "member" })
        .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, former)));
      const [currentEmail] = (
        await admin.db.select({ email: users.email }).from(users).where(eq(users.id, current))
      ).map((row) => row.email);
      const sent: EmailMessage[] = [];

      const result = await createCalendarJobs({
        notifier: fakeNotifier().notifier,
        repo: createPostgresCalendarRepository(probe.db),
        appUrl: "http://localhost:3000",
        now: () => new Date(created.getTime() + 60 * 60_000),
        send: async (message) => {
          sent.push(message);
        },
      }).sendDueReminders();

      expect(result).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((message) => message.to)).toEqual([currentEmail]);
      expect(emails).toHaveLength(2);
      const service = createCalendarService({
        repo: createPostgresCalendarRepository(probe.db),
        now: () => created,
      });
      const [listed] = await service.listOccurrences(user(current), communityId, {
        from: created,
        to: new Date(created.getTime() + 86_400_000),
      });
      expect(listed?.id).toBe(first.id);
      expect(listed?.goingCount).toBe(1);
    },
  );
});

describe("calendar.reminders for unconfirmed addresses", () => {
  it("sends no reminder to a member whose email is not confirmed and keeps it for later", async () => {
    const created = new Date("2031-03-24T08:00:00Z");
    const { going, emails } = await scenario(created, "2031-03-24T11:00");
    const [unconfirmed] = going;
    if (!unconfirmed) throw new Error("no attendee");
    await admin.db.update(users).set({ emailVerified: false }).where(eq(users.id, unconfirmed));
    const [unconfirmedEmail] = (
      await admin.db.select({ email: users.email }).from(users).where(eq(users.id, unconfirmed))
    ).map((row) => row.email);
    const sent: EmailMessage[] = [];
    const jobs = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      now: () => new Date("2031-03-24T09:00:00Z"),
      send: async (message) => {
        sent.push(message);
      },
    });

    expect(await jobs.sendDueReminders()).toEqual({ sent: 1, failed: 0 });
    expect(sent.map((message) => message.to)).toEqual(
      emails.filter((email) => email !== unconfirmedEmail),
    );

    await admin.db.update(users).set({ emailVerified: true }).where(eq(users.id, unconfirmed));
    expect(await jobs.sendDueReminders()).toEqual({ sent: 1, failed: 0 });
    expect(sent.at(-1)?.to).toBe(unconfirmedEmail);
  });
});

describe("calendar.extend", () => {
  it("tops up an open weekly series to 26 weeks ahead without duplicates", async () => {
    const created = new Date("2031-06-02T08:00:00Z");
    const { event } = await scenario(created, "2031-06-02T18:00");
    const later = new Date("2031-07-14T08:00:00Z");
    const jobs = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      now: () => later,
      send: async () => undefined,
    });

    const first = await jobs.extendSeries();
    const second = await jobs.extendSeries();
    const rows = await admin.db
      .select({ startsAt: eventOccurrences.startsAt })
      .from(eventOccurrences)
      .where(eq(eventOccurrences.eventId, event.id));

    expect(first.inserted).toBeGreaterThanOrEqual(6);
    expect(second.inserted).toBe(0);
    expect(rows).toHaveLength(26 + 6);
  });
});

describe("calendar.time-change", () => {
  function mailbox(at: () => Date) {
    const sent: EmailMessage[] = [];
    const jobs = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      now: at,
      send: async (message) => {
        sent.push(message);
      },
    });
    return { sent, jobs };
  }

  async function ownerOf(communityId: string) {
    const [owner] = await admin.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.communityId, communityId), eq(memberships.role, "owner")));
    if (!owner) throw new Error("no owner");
    return user(owner.userId);
  }

  async function edit(
    communityId: string,
    eventSlug: string,
    patch: Parameters<ReturnType<typeof createCalendarService>["updateEvent"]>[3],
    at: Date,
  ) {
    const queued: TimeChangeJobInput[] = [];
    const editor = createCalendarService({
      repo: createPostgresCalendarRepository(probe.db),
      now: () => at,
      queue: {
        scheduleTimeChange: async (payload) => {
          queued.push(payload);
        },
        scheduleNotice: async () => undefined,
      },
    });
    await editor.updateEvent(await ownerOf(communityId), communityId, eventSlug, patch);
    const [payload] = queued;
    if (!payload) throw new Error("no job queued");
    return timeChangeJobPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
  }

  async function reminderTimes(occurrenceId: string, userIds: string[]) {
    const rows = await admin.db
      .select({ reminderSentAt: eventRsvps.reminderSentAt })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.occurrenceId, occurrenceId), inArray(eventRsvps.userId, userIds)));
    return rows.map((row) => row.reminderSentAt);
  }

  it("clears sent reminders and emails people who are going the new time", async () => {
    let clock = new Date("2031-03-03T09:00:00Z");
    const { communityId, event, first, going, emails } = await scenario(
      new Date("2031-03-03T08:00:00Z"),
      "2031-03-03T11:00",
    );
    const { sent, jobs } = mailbox(() => clock);
    await jobs.sendDueReminders();
    const payload = await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-03-03T13:00" },
      new Date("2031-03-03T09:05:00Z"),
    );
    sent.length = 0;

    clock = new Date("2031-03-03T09:06:00Z");
    const result = await jobs.notifyTimeChange(payload);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(await reminderTimes(first.id, going)).toEqual([null, null]);
    expect(sent.map((message) => message.to).sort()).toEqual(emails);
    expect(sent[0]?.subject).toBe("[Calendar] New time: Reminder call");
    expect(sent[0]?.fromName).toBe("Calendar via Cohory");
    expect(sent[0]?.text).toContain("Was: Monday, March 3, 2031 at 11:00 AM (Europe/Berlin)");
    expect(sent[0]?.text).toContain("Now: Monday, March 3, 2031 at 1:00 PM (Europe/Berlin)");
    expect(sent[0]?.text).toContain(`/calendar/${event.slug}/${first.id}`);
    expect(sent[0]?.text).toContain(`/calendar/events/${event.slug}/ics`);

    sent.length = 0;
    clock = new Date("2031-03-03T11:00:00Z");
    await jobs.sendDueReminders();
    expect(sent.map((message) => message.to).sort()).toEqual(emails);
    expect(sent[0]?.subject).toBe("[Calendar] Starts in 1 hour: Reminder call");
  });

  it("keeps reminders sent after the change when the job runs again", async () => {
    let clock = new Date("2031-05-05T09:06:00Z");
    const { communityId, event, first, going } = await scenario(
      new Date("2031-05-05T08:00:00Z"),
      "2031-05-05T13:00",
    );
    const { jobs } = mailbox(() => clock);
    const payload = await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-05-05T15:00" },
      new Date("2031-05-05T09:05:00Z"),
    );
    await jobs.notifyTimeChange(payload);
    clock = new Date("2031-05-05T12:00:00Z");
    await jobs.sendDueReminders();

    await jobs.notifyTimeChange(payload);

    expect((await reminderTimes(first.id, going)).every((at) => at !== null)).toBe(true);
  });

  it("tells a burst of edits once, comparing the final time with the time before the burst", async () => {
    const { communityId, event, emails } = await scenario(
      new Date("2031-06-02T08:00:00Z"),
      "2031-06-02T18:00",
    );
    const { sent, jobs } = mailbox(() => new Date("2031-06-02T09:10:00Z"));
    const firstEdit = await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-06-02T19:00" },
      new Date("2031-06-02T09:00:00Z"),
    );
    await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-06-02T20:00" },
      new Date("2031-06-02T09:01:00Z"),
    );

    expect(await jobs.notifyTimeChange(firstEdit)).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((message) => message.to).sort()).toEqual(emails);
    expect(sent[0]?.text).toContain("Was: Monday, June 2, 2031 at 6:00 PM (Europe/Berlin)");
    expect(sent[0]?.text).toContain("Now: Monday, June 2, 2031 at 8:00 PM (Europe/Berlin)");
  });

  it("sends nothing when a burst of edits ends at the time members last heard", async () => {
    const { communityId, event } = await scenario(
      new Date("2031-06-09T08:00:00Z"),
      "2031-06-09T18:00",
    );
    const { sent, jobs } = mailbox(() => new Date("2031-06-09T09:10:00Z"));
    const firstEdit = await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-06-09T19:00" },
      new Date("2031-06-09T09:00:00Z"),
    );
    await edit(
      communityId,
      event.slug,
      { startsAtLocal: "2031-06-09T18:00" },
      new Date("2031-06-09T09:01:00Z"),
    );

    expect(await jobs.notifyTimeChange(firstEdit)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toEqual([]);
  });

  it("tells people going to a removed date that it is removed", async () => {
    const created = new Date("2031-07-07T08:00:00Z");
    const { communityId, event, going, emails } = await scenario(created, "2031-07-07T18:00");
    const [, second] = await admin.db
      .select({ id: eventOccurrences.id })
      .from(eventOccurrences)
      .where(eq(eventOccurrences.eventId, event.id))
      .orderBy(eventOccurrences.startsAt)
      .limit(2);
    if (!second) throw new Error("no second occurrence");
    const rsvps = createCalendarService({
      repo: createPostgresCalendarRepository(probe.db),
      now: () => created,
    });
    for (const userId of going) {
      await rsvps.rsvp(user(userId), communityId, second.id, { status: "going" });
    }
    const { sent, jobs } = mailbox(() => created);

    const payload = await edit(
      communityId,
      event.slug,
      { recurrence: null },
      new Date("2031-07-07T08:30:00Z"),
    );
    const result = await jobs.notifyTimeChange(payload);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((message) => message.to).sort()).toEqual(emails);
    expect(sent[0]?.subject).toBe("[Calendar] Date removed: Reminder call");
    expect(sent[0]?.text).toContain("Removed: Monday, July 14, 2031 at 6:00 PM (Europe/Berlin)");
  });

  it("reports a failed email and keeps sending to the others without failing the job", async () => {
    const created = new Date("2031-04-07T08:00:00Z");
    const { communityId, event, first } = await scenario(created, "2031-04-07T18:00");
    const failures: (string | null)[] = [];
    let calls = 0;
    const jobs = createCalendarJobs({
      notifier: fakeNotifier().notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      now: () => created,
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error("smtp down");
      },
      onSendError: (_error, failure) => {
        failures.push(failure.occurrenceId);
      },
    });

    const result = await jobs.notifyTimeChange({
      communityId,
      eventId: event.id,
      editorId: null,
      changedAt: created,
      previousZone: "Europe/Berlin",
      baseline: [{ occurrenceId: first.id, previousStart: new Date("2031-04-07T15:00:00Z") }],
      removals: [],
    });

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(failures).toEqual([first.id]);
  });
});

describe("calendar reminders and notices for members", () => {
  function jobsWith(notifier: FakeNotifier, at: Date, sent: EmailMessage[]) {
    return createCalendarJobs({
      notifier: notifier.notifier,
      repo: createPostgresCalendarRepository(probe.db),
      appUrl: "http://localhost:3000",
      inviteFrom: "events@example.test",
      now: () => at,
      send: async (message) => {
        sent.push(message);
      },
    });
  }

  it("sends the reminder in the member's time zone and records an in-app reminder", async () => {
    const created = new Date("2031-05-05T08:00:00Z");
    const { communityId, first, going } = await scenario(created, "2031-05-05T11:00");
    const notifier = fakeNotifier({ timeZone: "America/New_York" });
    const sent: EmailMessage[] = [];

    const result = await jobsWith(notifier, created, sent).sendDueReminders();

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sent[0]?.subject).toBe("[Calendar] Starts in 1 hour: Reminder call");
    expect(sent[0]?.text).toContain("When: Monday, May 5, 2031 at 5:00 AM (America/New_York)");
    expect(sent[0]?.text).toContain("Event time: Monday, May 5, 2031 at 11:00 AM (Europe/Berlin)");
    expect(notifier.reminders.map((r) => r.userId).sort()).toEqual([...going].sort());
    expect(notifier.reminders[0]).toMatchObject({
      communityId,
      occurrenceId: first.id,
      detail: "Starts in 1 hour: Reminder call",
    });
  });

  it("keeps the in-app reminder but sends no email when reminder emails are off", async () => {
    const created = new Date("2031-05-12T08:00:00Z");
    const { first } = await scenario(created, "2031-05-12T11:00");
    const notifier = fakeNotifier({ email: false });
    const sent: EmailMessage[] = [];
    const jobs = jobsWith(notifier, created, sent);

    const result = await jobs.sendDueReminders();
    await jobs.sendDueReminders();
    const claimed = await admin.db
      .select({ reminderSentAt: eventRsvps.reminderSentAt })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.occurrenceId, first.id), eq(eventRsvps.status, "going")));

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect(notifier.reminders).toHaveLength(2);
    expect(claimed.every((row) => row.reminderSentAt !== null)).toBe(true);
  });

  it("turns a new event notice into in-app notices named after the event", async () => {
    const created = new Date("2031-05-19T08:00:00Z");
    const { communityId, event } = await scenario(created, "2031-05-20T11:00");
    const actorId = await insertMember(admin.db, communityId, "admin");
    const notifier = fakeNotifier();

    await jobsWith(notifier, created, []).sendNotice({
      kind: "event_created",
      communityId,
      eventId: event.id,
      actorId,
    });

    expect(notifier.created).toEqual([
      { communityId, eventId: event.id, actorId, detail: "New event: Reminder call" },
    ]);
  });

  it("confirms an RSVP with a calendar invite, and sends nothing once the member stopped going", async () => {
    const created = new Date("2031-05-26T08:00:00Z");
    const { communityId, first, going, emails } = await scenario(created, "2031-05-27T11:00");
    const [userId] = going;
    if (!userId) throw new Error("no attendee");
    const sent: EmailMessage[] = [];
    const jobs = jobsWith(fakeNotifier(), created, sent);
    const notice = { kind: "rsvp_going" as const, communityId, occurrenceId: first.id, userId };

    const confirmed = await jobs.sendNotice(notice);
    await createCalendarService({
      repo: createPostgresCalendarRepository(probe.db),
      now: () => created,
    }).rsvp(user(userId), communityId, first.id, { status: "not_going" });
    const afterNo = await jobs.sendNotice(notice);

    expect(confirmed).toEqual({ sent: 1, failed: 0 });
    expect(afterNo).toEqual({ sent: 0, failed: 0 });
    expect(emails).toContain(sent[0]?.to);
    expect(sent[0]?.subject).toBe("[Calendar] You're going: Reminder call");
    expect(sent[0]?.calendarInvite?.method).toBe("REQUEST");
    expect(sent[0]?.calendarInvite?.content).toContain(
      'ORGANIZER;CN="Calendar":mailto:events@example.test',
    );
    expect(sent[0]?.calendarInvite?.content).toContain(`UID:${first.id}@cohory`);
  });
});
