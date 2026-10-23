import type { CommunityId, Database } from "@cohory/db";
import type { EmailMessage } from "@cohory/email";
import { users } from "@cohory/db/schema";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { icsSequence } from "./ics";
import { calendarNoticeSchema, type CalendarNoticeInput } from "./notices";
import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarJobs } from "./reminders";
import { createCalendarService } from "./service";
import { timeChangeJobPayloadSchema, type TimeChangeJobInput } from "./time-change";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";
import { fakeNotifier } from "./test/notifier";
import { closeBilling, setSubscription, subscribe } from "./test/paid";
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

function service(at: Date, notices: CalendarNoticeInput[] = [], moves: TimeChangeJobInput[] = []) {
  return createCalendarService({
    repo: createPostgresCalendarRepository(probe.db),
    now: () => at,
    queue: {
      scheduleTimeChange: async (payload) => {
        moves.push(payload);
      },
      scheduleNotice: async (payload) => {
        notices.push(payload);
      },
    },
  });
}

function mailbox(at: () => Date, notifier = fakeNotifier()) {
  const sent: EmailMessage[] = [];
  const jobs = createCalendarJobs({
    notifier: notifier.notifier,
    repo: createPostgresCalendarRepository(probe.db),
    appUrl: "http://localhost:3000",
    inviteFrom: "events@example.test",
    now: at,
    send: async (message) => {
      sent.push(message);
    },
  });
  return { sent, jobs, notifier };
}

function queued(notice: CalendarNoticeInput | undefined) {
  if (!notice) throw new Error("no notice");
  return calendarNoticeSchema.parse(JSON.parse(JSON.stringify(notice)));
}

function sequenceOf(message: EmailMessage | undefined): number {
  const line = message?.calendarInvite?.content
    .split("\r\n")
    .find((entry) => entry.startsWith("SEQUENCE:"));
  return Number(line?.slice("SEQUENCE:".length));
}

async function emailsOf(userIds: readonly string[]): Promise<string[]> {
  const rows = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return rows.map((row) => row.email).sort();
}

async function scenario(
  created: Date,
  startsAtLocal: string,
  attendees?: { communityId: CommunityId; userIds: readonly string[] },
) {
  const id = attendees?.communityId ?? (await insertCommunity(admin.db));
  const owner = user(await insertMember(admin.db, id, "owner"));
  const going = attendees
    ? [...attendees.userIds]
    : [await insertMember(admin.db, id), await insertMember(admin.db, id)];
  const calendar = service(created);
  const event = await calendar.createEvent(owner, id, {
    title: "Invite call",
    startsAtLocal,
    timeZone: "Europe/Berlin",
    durationMinutes: 60,
    recurrence: "weekly",
    location: "https://meet.example.com/invite",
  });
  const [first, second] = await calendar.listOccurrences(owner, id, {
    from: created,
    to: new Date(created.getTime() + 15 * 86_400_000),
  });
  if (!first || !second) throw new Error("no occurrences");
  for (const userId of going) {
    await calendar.rsvp(user(userId), id, first.id, { status: "going" });
  }
  return { communityId: id, owner, event, first, second, going };
}

describe("calendar invites", () => {
  it("sends people going to a moved date an updated invite for the same entry", async () => {
    const created = new Date("2032-03-01T08:00:00Z");
    const { communityId, owner, event, first, going } = await scenario(created, "2032-03-02T11:00");
    const { sent, jobs } = mailbox(() => created);
    for (const userId of going) {
      await jobs.sendNotice({ kind: "rsvp_going", communityId, occurrenceId: first.id, userId });
    }
    const confirmation = sent[0];
    sent.length = 0;
    const moves: TimeChangeJobInput[] = [];
    const editedAt = new Date("2032-03-01T09:00:00Z");
    await service(editedAt, [], moves).updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2032-03-02T13:00",
    });
    const [payload] = moves;
    if (!payload) throw new Error("no job");

    const later = new Date("2032-03-01T09:01:00Z");
    const run = mailbox(() => later);
    const result = await run.jobs.notifyTimeChange(
      timeChangeJobPayloadSchema.parse(JSON.parse(JSON.stringify(payload))),
    );

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(run.sent.map((message) => message.to).sort()).toEqual(await emailsOf(going));
    const update = run.sent[0];
    expect(update?.calendarInvite?.method).toBe("REQUEST");
    expect(update?.calendarInvite?.content).toContain(`UID:${first.id}@cohory`);
    expect(update?.calendarInvite?.content).toContain("DTSTART;TZID=Europe/Berlin:20320302T130000");
    expect(sequenceOf(update)).toBe(icsSequence(later));
    expect(sequenceOf(update)).toBeGreaterThan(sequenceOf(confirmation));
  });

  it("cancels the entry for people going when a date is canceled, and restores it", async () => {
    const created = new Date("2032-03-08T08:00:00Z");
    const { communityId, owner, first, going } = await scenario(created, "2032-03-09T11:00");
    const notices: CalendarNoticeInput[] = [];
    await service(created, notices).cancelOccurrence(owner, communityId, first.id);

    expect(notices).toEqual([{ kind: "date_status", communityId, occurrenceId: first.id }]);
    const canceledAt = new Date("2032-03-08T08:00:30Z");
    const canceled = mailbox(() => canceledAt);
    const [notice] = notices;
    if (!notice) throw new Error("no notice");
    expect(await canceled.jobs.sendNotice(queued(notice))).toEqual({ sent: 2, failed: 0 });
    expect(canceled.sent.map((message) => message.to).sort()).toEqual(await emailsOf(going));
    expect(canceled.sent[0]?.subject).toBe("[Calendar] Canceled: Invite call");
    expect(canceled.sent[0]?.calendarInvite?.method).toBe("CANCEL");
    expect(canceled.sent[0]?.calendarInvite?.content).toContain(`UID:${first.id}@cohory`);
    expect(canceled.sent[0]?.calendarInvite?.content).toContain("STATUS:CANCELLED");
    expect(sequenceOf(canceled.sent[0])).toBe(icsSequence(canceledAt));

    await service(created, notices).uncancelOccurrence(owner, communityId, first.id);
    const restoredAt = new Date("2032-03-08T08:01:00Z");
    const restored = mailbox(() => restoredAt);
    expect(await restored.jobs.sendNotice(queued(notice))).toEqual({ sent: 2, failed: 0 });
    expect(restored.sent[0]?.calendarInvite?.method).toBe("REQUEST");
    expect(sequenceOf(restored.sent[0])).toBeGreaterThan(sequenceOf(canceled.sent[0]));
  });

  it("cancels every upcoming entry of a deleted event", async () => {
    const created = new Date("2032-03-15T08:00:00Z");
    const { communityId, owner, event, first, second, going } = await scenario(
      created,
      "2032-03-16T11:00",
    );
    const [both] = going;
    if (!both) throw new Error("no attendee");
    await service(created).rsvp(user(both), communityId, second.id, { status: "going" });
    const notices: CalendarNoticeInput[] = [];
    await service(created, notices).deleteEvent(owner, communityId, event.slug);

    const [notice] = notices;
    expect(notice?.kind).toBe("event_deleted");
    if (!notice) throw new Error("no notice");
    const deletedAt = new Date("2032-03-15T08:00:10Z");
    const run = mailbox(() => deletedAt);
    const result = await run.jobs.sendNotice(queued(notice));

    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(run.sent.every((message) => message.calendarInvite?.method === "CANCEL")).toBe(true);
    const uids = run.sent.map((message) =>
      message.calendarInvite?.content.split("\r\n").find((line) => line.startsWith("UID:")),
    );
    expect(uids.sort()).toEqual(
      [`UID:${first.id}@cohory`, `UID:${first.id}@cohory`, `UID:${second.id}@cohory`].sort(),
    );
    expect(run.sent[0]?.text).toContain("no longer takes place");
  });

  it("cancels the entry when a member stops going, unless they go again first", async () => {
    const created = new Date("2032-03-22T08:00:00Z");
    const { communityId, first, going } = await scenario(created, "2032-03-23T11:00");
    const [userId] = going;
    if (!userId) throw new Error("no attendee");
    const notices: CalendarNoticeInput[] = [];
    await service(created, notices).rsvp(user(userId), communityId, first.id, {
      status: "not_going",
    });

    expect(notices).toEqual([
      { kind: "rsvp_not_going", communityId, occurrenceId: first.id, userId },
    ]);
    const [notice] = notices;
    if (!notice) throw new Error("no notice");
    const run = mailbox(() => new Date("2032-03-22T08:00:20Z"));
    expect(await run.jobs.sendNotice(queued(notice))).toEqual({ sent: 1, failed: 0 });
    expect(run.sent[0]?.to).toBe((await emailsOf([userId]))[0]);
    expect(run.sent[0]?.subject).toBe("[Calendar] Not going: Invite call");
    expect(run.sent[0]?.calendarInvite?.method).toBe("CANCEL");

    await service(created).rsvp(user(userId), communityId, first.id, { status: "going" });
    const again = mailbox(() => new Date("2032-03-22T08:00:40Z"));
    expect(await again.jobs.sendNotice(queued(notice))).toEqual({ sent: 0, failed: 0 });
  });
});

describe("calendar emails and paid access", () => {
  async function paidScenario(created: Date, startsAtLocal: string) {
    const communityId = await insertCommunity(admin.db);
    const grace = await insertMember(admin.db, communityId);
    const ended = await insertMember(admin.db, communityId);
    const paying = await insertMember(admin.db, communityId);
    const periodEnd = new Date(created.getTime() + 30 * 86_400_000);
    const graceSub = await subscribe(admin.db, communityId, grace, periodEnd);
    const endedSub = await subscribe(admin.db, communityId, ended, periodEnd);
    await subscribe(admin.db, communityId, paying, periodEnd);
    const base = await scenario(created, startsAtLocal, {
      communityId,
      userIds: [grace, ended, paying],
    });
    const dayBefore = new Date(created.getTime() - 86_400_000);
    await setSubscription(admin.db, communityId, graceSub, {
      providerStatus: "past_due",
      accessState: "grace",
    });
    await setSubscription(admin.db, communityId, endedSub, {
      providerStatus: "active",
      accessState: "granted",
      currentPeriodEnd: dayBefore,
    });
    await closeBilling(admin.db, communityId, dayBefore);
    return { ...base, grace, ended, paying };
  }

  it("reminds members with access, past due ones in grace too, and not a member whose access ended", async () => {
    const created = new Date("2032-04-05T08:00:00Z");
    const { first, grace, ended, paying } = await paidScenario(created, "2032-04-05T11:00");
    const run = mailbox(() => created);

    await run.jobs.sendDueReminders();

    expect(run.sent.map((message) => message.to).sort()).toEqual(await emailsOf([grace, paying]));
    expect(run.notifier.reminders.map((notice) => notice.userId).sort()).toEqual(
      [grace, paying].sort(),
    );
    expect(run.notifier.reminders.every((notice) => notice.occurrenceId === first.id)).toBe(true);
    expect(run.notifier.reminders.map((notice) => notice.userId)).not.toContain(ended);

    const again = mailbox(() => new Date(created.getTime() + 5 * 60_000));
    await again.jobs.sendDueReminders();
    expect(again.sent).toEqual([]);
  });

  it("sends no RSVP confirmation or updated invite once a member's access ended", async () => {
    const created = new Date("2032-04-12T08:00:00Z");
    const { communityId, owner, event, first, ended, grace } = await paidScenario(
      created,
      "2032-04-13T11:00",
    );
    const run = mailbox(() => created);

    expect(
      await run.jobs.sendNotice({
        kind: "rsvp_going",
        communityId,
        occurrenceId: first.id,
        userId: ended,
      }),
    ).toEqual({ sent: 0, failed: 0 });

    const moves: TimeChangeJobInput[] = [];
    await service(created, [], moves).updateEvent(owner, communityId, event.slug, {
      startsAtLocal: "2032-04-13T13:00",
    });
    const [payload] = moves;
    if (!payload) throw new Error("no job");
    const moved = mailbox(() => created);
    await moved.jobs.notifyTimeChange(timeChangeJobPayloadSchema.parse(payload));
    const recipients = moved.sent.map((message) => message.to);
    expect(recipients).toContain((await emailsOf([grace]))[0]);
    expect(recipients).not.toContain((await emailsOf([ended]))[0]);
  });
});
