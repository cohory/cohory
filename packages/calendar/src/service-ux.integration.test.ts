import { ForbiddenError } from "@cohory/authz";
import { newId, type CommunityId } from "@cohory/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CalendarValidationError } from "./errors";
import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarService } from "./service";
import type { CalendarNoticeInput } from "./notices";
import { insertCommunity, insertMember, insertUser, openTestDb, user } from "./test/fixtures";

const admin = openTestDb();
let clock = new Date("2026-10-18T10:00:00Z");
let notices: CalendarNoticeInput[] = [];
const service = createCalendarService({
  repo: createPostgresCalendarRepository(admin.db),
  appUrl: "http://localhost:3000/",
  now: () => clock,
  queue: {
    scheduleTimeChange: () => Promise.resolve(),
    scheduleNotice: (payload) => {
      notices.push(payload);
      return Promise.resolve();
    },
  },
});

beforeEach(() => {
  notices = [];
  clock = new Date("2026-10-18T10:00:00Z");
});

afterAll(async () => {
  await admin.close();
});

const weekly = {
  title: "Weekly call",
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
  const ownerId = await insertMember(admin.db, communityId, "owner");
  const memberId = await insertMember(admin.db, communityId, "member");
  return { communityId, owner: user(ownerId), ownerId, member: user(memberId), memberId };
}

async function firstOccurrence(communityId: CommunityId) {
  const owner = await insertMember(admin.db, communityId, "admin");
  const [first, ...rest] = await service.listOccurrences(user(owner), communityId, range);
  if (!first) throw new Error("no occurrence");
  return { first, rest };
}

describe("event covers", () => {
  it("stores a cover uploaded to this community and clears it on request", async () => {
    const { communityId, owner, member } = await setup();
    const coverKey = `communities/${communityId}/posts/${newId()}.png`;

    const event = await service.createEvent(owner, communityId, { ...weekly, coverKey });
    const { first } = await firstOccurrence(communityId);
    const seen = await service.getOccurrence(member, communityId, event.slug, first.id);
    const cleared = await service.updateEvent(owner, communityId, event.slug, { coverKey: null });

    expect(event.coverKey).toBe(coverKey);
    expect(seen.event.coverKey).toBe(coverKey);
    expect(cleared.coverKey).toBeNull();
  });

  it("refuses a cover from another community or a file that is not an image", async () => {
    const { communityId, owner } = await setup();
    const other = await insertCommunity(admin.db);

    await expect(
      service.createEvent(owner, communityId, {
        ...weekly,
        coverKey: `communities/${other}/posts/${newId()}.png`,
      }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
    await expect(
      service.createEvent(owner, communityId, {
        ...weekly,
        coverKey: `communities/${communityId}/posts/${newId()}.pdf`,
      }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });
});

describe("event notices", () => {
  it("queues a new event notice only when the creator asks to notify members", async () => {
    const { communityId, owner, ownerId } = await setup();

    const quiet = await service.createEvent(owner, communityId, weekly);
    const loud = await service.createEvent(owner, communityId, { ...weekly, notifyMembers: true });

    expect(quiet.slug).toBe("weekly-call");
    expect(notices).toEqual([
      { kind: "event_created", communityId, eventId: loud.id, actorId: ownerId },
    ]);
  });

  it("refuses a new event notice asked for by an agent, so only a person can notify every member", async () => {
    const { communityId, ownerId } = await setup();
    const agent = {
      ...user(ownerId),
      credential: {
        type: "agent" as const,
        tokenId: newId(),
        agentId: newId(),
        communityId,
        scopes: ["events:write" as const],
        via: "api" as const,
      },
    };

    await expect(
      service.createEvent(agent, communityId, { ...weekly, notifyMembers: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const quiet = await service.createEvent(agent, communityId, weekly);

    expect(quiet.slug).toBe("weekly-call");
    expect(notices).toEqual([]);
  });

  it("refuses a new event notice asked for with a personal API token, so only a signed in person sends it", async () => {
    const { communityId, ownerId } = await setup();
    const personal = {
      ...user(ownerId),
      credential: {
        type: "user" as const,
        tokenId: newId(),
        agentId: null,
        communityId,
        scopes: ["events:write" as const],
        via: "api" as const,
      },
    };

    await expect(
      service.createEvent(personal, communityId, { ...weekly, notifyMembers: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(notices).toEqual([]);
  });

  it("queues an RSVP confirmation when a member starts going, not on a repeat or a no", async () => {
    const { communityId, owner, member, memberId } = await setup();
    await service.createEvent(owner, communityId, weekly);
    const { first, rest } = await firstOccurrence(communityId);
    const second = rest[0];
    if (!second) throw new Error("no second occurrence");

    await service.rsvp(member, communityId, first.id, { status: "going" });
    await service.rsvp(member, communityId, first.id, { status: "going" });
    await service.rsvp(member, communityId, second.id, { status: "not_going" });

    expect(notices).toEqual([
      { kind: "rsvp_going", communityId, occurrenceId: first.id, userId: memberId },
    ]);
  });
});

describe("faces and replays", () => {
  it("shows members up to five faces of people going and guests none", async () => {
    const { communityId, owner, member } = await setup("public");
    const event = await service.createEvent(owner, communityId, weekly);
    const { first } = await firstOccurrence(communityId);
    const goers = [];
    for (let index = 0; index < 6; index += 1) {
      const id = await insertMember(admin.db, communityId);
      goers.push(id);
      await service.rsvp(user(id), communityId, first.id, { status: "going" });
    }
    const guest = user(await insertUser(admin.db));

    const [listed] = await service.listOccurrences(member, communityId, range);
    const detail = await service.getOccurrence(member, communityId, event.slug, first.id);
    const asGuest = await service.getOccurrence(guest, communityId, event.slug, first.id);

    expect(listed?.goingCount).toBe(6);
    expect(listed?.going.map((face) => face.userId)).toEqual(goers.slice(0, 5));
    expect(detail.going).toHaveLength(5);
    expect(asGuest.going).toEqual([]);
  });

  it("gives members the recording link of a past date and guests nothing", async () => {
    const { communityId, owner, member } = await setup("public");
    const event = await service.createEvent(owner, communityId, weekly);
    await service.setRecordingUrl(owner, communityId, event.slug, {
      recordingUrl: "https://video.example.com/r1",
    });
    clock = new Date("2026-11-20T10:00:00Z");
    const guest = user(await insertUser(admin.db));

    const [asMember] = await service.listOccurrences(member, communityId, range);
    const [asGuest] = await service.listOccurrences(guest, communityId, range);

    expect(asMember?.recordingUrl).toBe("https://video.example.com/r1");
    expect(asGuest?.recordingUrl).toBeNull();
  });
});

describe("deleting a series", () => {
  it("counts RSVPs on upcoming dates before a manager deletes the series", async () => {
    const { communityId, owner, member } = await setup();
    const event = await service.createEvent(owner, communityId, weekly);
    const { first, rest } = await firstOccurrence(communityId);
    const [second, third] = rest;
    if (!second || !third) throw new Error("no later occurrences");
    const other = user(await insertMember(admin.db, communityId));
    await service.rsvp(member, communityId, first.id, { status: "going" });
    await service.rsvp(member, communityId, second.id, { status: "going" });
    await service.rsvp(other, communityId, second.id, { status: "going" });
    await service.cancelOccurrence(owner, communityId, third.id);
    clock = new Date("2026-10-19T10:00:00Z");

    const preview = await service.previewEventDelete(owner, communityId, event.slug);

    expect(preview).toEqual({ rsvps: 2, dates: 2 });
    await expect(
      service.previewEventDelete(member, communityId, event.slug),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
