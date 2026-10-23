import { ForbiddenError } from "@cohory/authz";
import { newId, type CommunityId } from "@cohory/db";
import { memberships } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityNotFoundError } from "../errors";
import { backfillLastSeen } from "./activity";
import { createPostgresManageRepository } from "./postgres-repository";
import {
  insertCast,
  insertMember,
  openManageHarness,
  type Cast,
  type ManageHarness,
  type UserActor,
} from "../test/manage-fixtures";

const now = new Date("2026-10-19T12:00:00.000Z");
const longAgo = new Date("2026-01-01T00:00:00.000Z");
let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness({ now: () => now });
});

afterAll(async () => {
  await h.close();
});

async function setJoined(communityId: CommunityId, actor: UserActor, joinedAt: Date) {
  await h.admin
    .update(memberships)
    .set({ joinedAt, lastSeenAt: null, createdAt: joinedAt })
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, actor.userId)));
}

async function post(communityId: CommunityId, actor: UserActor, at: Date): Promise<string> {
  const id = newId();
  await h.admin.execute(sql`
    insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt, created_at, updated_at)
    values (${id}, ${communityId}, ${actor.userId}, '{"type":"doc","content":[]}', '', '', '', ${at.toISOString()}, ${at.toISOString()})`);
  return id;
}

async function like(
  communityId: CommunityId,
  actor: UserActor,
  postId: string,
  author: UserActor,
  at: Date,
) {
  await h.admin.execute(sql`
    insert into reactions (id, community_id, user_id, subject_type, subject_id, subject_author_id, created_at, updated_at)
    values (${newId()}, ${communityId}, ${actor.userId}, 'post', ${postId}, ${author.userId}, ${at.toISOString()}, ${at.toISOString()})`);
}

async function viewLesson(communityId: CommunityId, actor: UserActor, at: Date) {
  const course = newId();
  const module = newId();
  const lesson = newId();
  await h.admin.execute(sql`
    insert into courses (id, community_id, slug, title, position) values (${course}, ${communityId}, ${`c-${course.slice(-8)}`}, 'Course', 0)`);
  await h.admin.execute(sql`
    insert into course_modules (id, community_id, course_id, title, position) values (${module}, ${communityId}, ${course}, 'Module', 0)`);
  await h.admin.execute(sql`
    insert into lessons (id, community_id, module_id, course_id, slug, title, position) values (${lesson}, ${communityId}, ${module}, ${course}, 'lesson', 'Lesson', 0)`);
  await h.admin.execute(sql`
    insert into lesson_progress (community_id, lesson_id, course_id, user_id, last_viewed_at) values (${communityId}, ${lesson}, ${course}, ${actor.userId}, ${at.toISOString()})`);
}

async function rsvp(communityId: CommunityId, actor: UserActor, at: Date) {
  const event = newId();
  const occurrence = newId();
  await h.admin.execute(sql`
    insert into events (id, community_id, slug, title, starts_at_local, time_zone, duration_minutes)
    values (${event}, ${communityId}, ${`e-${event.slice(-8)}`}, 'Event', '2026-11-01 10:00:00', 'UTC', 60)`);
  await h.admin.execute(sql`
    insert into event_occurrences (id, community_id, event_id, starts_at, ends_at)
    values (${occurrence}, ${communityId}, ${event}, '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z')`);
  await h.admin.execute(sql`
    insert into event_rsvps (community_id, occurrence_id, user_id, status, created_at, updated_at)
    values (${communityId}, ${occurrence}, ${actor.userId}, 'going', ${at.toISOString()}, ${at.toISOString()})`);
}

async function session(actor: UserActor, at: Date) {
  await h.admin.execute(sql`
    insert into sessions (id, user_id, token, expires_at, created_at, updated_at)
    values (${newId()}, ${actor.userId}, ${newId()}, '2027-01-01T00:00:00Z', ${at.toISOString()}, ${at.toISOString()})`);
}

async function inactiveNames(cast: Cast, days: number): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      inactiveDays: days,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    names.push(...page.data.map((member) => member.name));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return names.sort();
}

describe("inactive members", () => {
  let cast: Cast;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
    const id = cast.communityId;
    for (const actor of [cast.owner, cast.admin, cast.moderator, cast.member]) {
      await setJoined(id, actor, longAgo);
      await session(actor, new Date("2026-10-18T09:00:00Z"));
    }
    const recentPoster = await insertMember(h.admin, id, "member", "active", "Recent poster");
    const oldPoster = await insertMember(h.admin, id, "member", "active", "Old poster");
    const liker = await insertMember(h.admin, id, "member", "active", "Liker");
    const learner = await insertMember(h.admin, id, "member", "active", "Learner");
    const attendee = await insertMember(h.admin, id, "member", "active", "Attendee");
    const signedIn = await insertMember(h.admin, id, "member", "active", "Signed in");
    const lurker = await insertMember(h.admin, id, "member", "active", "Lurker");
    const newcomer = await insertMember(h.admin, id, "member", "active", "Newcomer");
    const banned = await insertMember(h.admin, id, "member", "banned", "Banned");
    for (const actor of [
      recentPoster,
      oldPoster,
      liker,
      learner,
      attendee,
      signedIn,
      lurker,
      banned,
    ]) {
      await setJoined(id, actor, longAgo);
    }
    await setJoined(id, newcomer, new Date("2026-10-15T00:00:00Z"));
    const oldPost = await post(id, oldPoster, new Date("2026-08-01T00:00:00Z"));
    await post(id, recentPoster, new Date("2026-10-10T00:00:00Z"));
    await like(id, liker, oldPost, oldPoster, new Date("2026-10-15T00:00:00Z"));
    await viewLesson(id, learner, new Date("2026-10-12T00:00:00Z"));
    await rsvp(id, attendee, new Date("2026-10-01T00:00:00Z"));
    await session(signedIn, new Date("2026-10-17T00:00:00Z"));
    await session(lurker, new Date("2026-05-01T00:00:00Z"));
  });

  it("lists active members whose last activity is older than N days, across pages", async () => {
    expect(await inactiveNames(cast, 30)).toEqual(["Lurker", "Old poster"]);
    expect(await inactiveNames(cast, 10)).toEqual(["Attendee", "Lurker", "Old poster"]);
    expect(await inactiveNames(cast, 3)).toEqual([
      "Attendee",
      "Learner",
      "Liker",
      "Lurker",
      "Newcomer",
      "Old poster",
      "Recent poster",
    ]);
  });

  it("returns the last active time with each member", async () => {
    const page = await h.service.listMembersForManage(cast.admin, cast.communityId, {
      inactiveDays: 30,
    });
    const lurker = page.data.find((member) => member.name === "Lurker");
    expect(lurker?.lastActiveAt?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    const all = await h.service.listMembersForManage(cast.admin, cast.communityId, { limit: 100 });
    expect(all.data.find((m) => m.name === "Liker")?.lastActiveAt?.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
  });

  it("lets moderators filter and refuses members", async () => {
    await expect(inactiveNamesAs(cast.moderator)).resolves.toContain("Lurker");
    await expect(inactiveNamesAs(cast.member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never returns members of another community", async () => {
    const other = await insertCast(h.admin);
    await insertMember(h.admin, other.communityId, "member", "active", "Other lurker").then(
      (actor) => setJoined(other.communityId, actor, longAgo),
    );
    expect(await inactiveNames(cast, 30)).not.toContain("Other lurker");
    await expect(
      h.service.listMembersForManage(cast.owner, other.communityId, { inactiveDays: 30 }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("rejects an out of range number of days", async () => {
    await expect(
      h.service.listMembersForManage(cast.owner, cast.communityId, { inactiveDays: 0 }),
    ).rejects.toThrow();
    await expect(
      h.service.listMembersForManage(cast.owner, cast.communityId, { inactiveDays: 3651 }),
    ).rejects.toThrow();
  });

  async function inactiveNamesAs(actor: UserActor): Promise<string[]> {
    const page = await h.service.listMembersForManage(actor, cast.communityId, {
      inactiveDays: 30,
      limit: 100,
    });
    return page.data.map((member) => member.name);
  }
});

describe("backfillLastSeen", () => {
  it("fills last_seen_at in batches from past activity, then joined_at, and becomes a no op", async () => {
    const cast = await insertCast(h.admin);
    const id = cast.communityId;
    const poster = await insertMember(h.admin, id, "member", "active", "Poster");
    const extra = await Promise.all(Array.from({ length: 4 }, () => insertMember(h.admin, id)));
    await post(id, poster, new Date("2026-06-01T00:00:00Z"));
    for (const actor of [cast.owner, cast.admin, cast.moderator, cast.member, poster, ...extra]) {
      await setJoined(id, actor, longAgo);
    }
    const repo = createPostgresManageRepository(h.app);

    const first = await backfillLastSeen(repo, { batchSize: 3, communityIds: [id] });
    expect(first).toEqual({ communities: 1, updated: 9, batches: 4 });

    const rows = await h.admin
      .select({ userId: memberships.userId, lastSeenAt: memberships.lastSeenAt })
      .from(memberships)
      .where(eq(memberships.communityId, id));
    expect(rows.every((row) => row.lastSeenAt !== null)).toBe(true);
    expect(rows.find((row) => row.userId === poster.userId)?.lastSeenAt?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(rows.find((row) => row.userId === cast.member.userId)?.lastSeenAt?.toISOString()).toBe(
      longAgo.toISOString(),
    );

    const second = await backfillLastSeen(repo, { batchSize: 3, communityIds: [id] });
    expect(second).toEqual({ communities: 1, updated: 0, batches: 1 });
  });
});
