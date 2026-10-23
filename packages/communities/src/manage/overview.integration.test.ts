import { ForbiddenError } from "@cohory/authz";
import { newId, type CommunityId } from "@cohory/db";
import { communities, memberships } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CommunityHealth } from "./health";
import {
  insertCommunity,
  insertMember,
  openManageHarness,
  type ManageHarness,
  type UserActor,
} from "../test/manage-fixtures";

const now = new Date("2026-10-19T12:00:00.000Z");
let h: ManageHarness;
let communityId: CommunityId;
let owner: UserActor;
let adminUser: UserActor;
let m1: UserActor;
let m2: UserActor;
let m3: UserActor;
let m4: UserActor;

const iso = (value: string) => new Date(value).toISOString();

async function setMembership(actor: UserActor, joinedAt: string, lastSeenAt: string | null) {
  await h.admin
    .update(memberships)
    .set({
      joinedAt: new Date(joinedAt),
      createdAt: new Date(joinedAt),
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null,
    })
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, actor.userId)));
}

async function post(
  author: UserActor,
  createdAt: string,
  options: { pinned?: boolean; likes?: number; comments?: number } = {},
): Promise<string> {
  const id = newId();
  await h.admin.execute(sql`
    insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt, pinned_at, like_count, comment_count, created_at, updated_at)
    values (${id}, ${communityId}, ${author.userId}, '{"type":"doc","content":[]}', '', '', 'Hello',
      ${options.pinned ? iso(createdAt) : null}, ${options.likes ?? 0}, ${options.comments ?? 0},
      ${iso(createdAt)}, ${iso(createdAt)})`);
  return id;
}

async function comment(author: UserActor, postId: string, createdAt: string) {
  await h.admin.execute(sql`
    insert into comments (id, community_id, post_id, author_id, body, body_html, body_text, created_at, updated_at)
    values (${newId()}, ${communityId}, ${postId}, ${author.userId}, '{"type":"doc","content":[]}', '', '', ${iso(createdAt)}, ${iso(createdAt)})`);
}

async function like(actor: UserActor, postId: string, author: UserActor, createdAt: string) {
  await h.admin.execute(sql`
    insert into reactions (id, community_id, user_id, subject_type, subject_id, subject_author_id, created_at, updated_at)
    values (${newId()}, ${communityId}, ${actor.userId}, 'post', ${postId}, ${author.userId}, ${iso(createdAt)}, ${iso(createdAt)})`);
}

async function publishedCourseWithCompletions(completions: readonly [UserActor, string][]) {
  const course = newId();
  const module = newId();
  const lesson = newId();
  await h.admin.execute(sql`
    insert into courses (id, community_id, slug, title, position, status)
    values (${course}, ${communityId}, ${`c-${course.slice(-8)}`}, 'Course', 0, 'published')`);
  await h.admin.execute(sql`
    insert into course_modules (id, community_id, course_id, title, position) values (${module}, ${communityId}, ${course}, 'Module', 0)`);
  await h.admin.execute(sql`
    insert into lessons (id, community_id, module_id, course_id, slug, title, position) values (${lesson}, ${communityId}, ${module}, ${course}, 'lesson', 'Lesson', 0)`);
  for (const [actor, completedAt] of completions) {
    await h.admin.execute(sql`
      insert into lesson_progress (community_id, lesson_id, course_id, user_id, completed_at, last_viewed_at)
      values (${communityId}, ${lesson}, ${course}, ${actor.userId}, ${iso(completedAt)}, ${iso(completedAt)})`);
  }
}

async function upcomingEvent() {
  const event = newId();
  await h.admin.execute(sql`
    insert into events (id, community_id, slug, title, starts_at_local, time_zone, duration_minutes)
    values (${event}, ${communityId}, ${`e-${event.slice(-8)}`}, 'Event', '2026-11-01 10:00:00', 'UTC', 60)`);
  await h.admin.execute(sql`
    insert into event_occurrences (id, community_id, event_id, starts_at, ends_at)
    values (${newId()}, ${communityId}, ${event}, '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z')`);
}

beforeAll(async () => {
  h = await openManageHarness({ now: () => now });
  communityId = (await insertCommunity(h.admin)).id;
  owner = await insertMember(h.admin, communityId, "owner");
  adminUser = await insertMember(h.admin, communityId, "admin");
  m1 = await insertMember(h.admin, communityId);
  m2 = await insertMember(h.admin, communityId);
  m3 = await insertMember(h.admin, communityId);
  m4 = await insertMember(h.admin, communityId);
  await setMembership(owner, "2026-01-01T00:00:00Z", "2026-10-19T08:00:00Z");
  await setMembership(adminUser, "2026-01-01T00:00:00Z", "2026-10-19T08:00:00Z");
  await setMembership(m1, "2026-01-01T00:00:00Z", "2026-10-18T00:00:00Z");
  await setMembership(m2, "2026-10-16T00:00:00Z", null);
  await setMembership(m3, "2026-10-17T00:00:00Z", null);
  await setMembership(m4, "2026-10-08T00:00:00Z", "2026-10-08T00:00:00Z");

  await post(owner, "2026-10-16T00:00:00Z", { pinned: true });
  const top = await post(m1, "2026-10-15T00:00:00Z", { likes: 2, comments: 1 });
  const m3Post = await post(m3, "2026-10-17T00:00:00Z");
  const m4Post = await post(m4, "2026-10-09T00:00:00Z", { pinned: true });
  await comment(m1, m4Post, "2026-10-10T00:00:00Z");
  await comment(owner, top, "2026-10-15T06:00:00Z");
  await like(owner, m3Post, m3, "2026-10-17T06:00:00Z");
  await publishedCourseWithCompletions([
    [m1, "2026-10-14T00:00:00Z"],
    [owner, "2026-10-14T00:00:00Z"],
  ]);
  await upcomingEvent();
  await h.admin.execute(sql`
    insert into community_gallery_items (id, community_id, kind, embed_url, position)
    values (${newId()}, ${communityId}, 'video_embed', 'https://www.loom.com/embed/0123456789abcdef', 0)`);

  const other = (await insertCommunity(h.admin)).id;
  await insertMember(h.admin, other);
});

afterAll(async () => {
  await h.close();
});

describe("community health", () => {
  let health: CommunityHealth;

  beforeAll(async () => {
    health = await h.service.getCommunityHealth(owner, communityId);
  });

  it("counts members without the owner and staff, against a week ago", () => {
    expect(health.members).toEqual({ current: 4, previous: 2 });
    expect(health.newMembers).toEqual({ current: 2, previous: 1 });
  });

  it("counts members active in the last 7 and 30 days", () => {
    expect(health.activeMembers7d).toBe(3);
    expect(health.activeMembers30d).toBe(4);
  });

  it("counts member posts, comments and completed lessons this week and last week, without staff", () => {
    expect(health.posts).toEqual({ current: 2, previous: 1 });
    expect(health.comments).toEqual({ current: 0, previous: 1 });
    expect(health.lessonsCompleted).toEqual({ current: 1, previous: 0 });
  });

  it("finds new members nobody on the team has greeted yet", () => {
    expect(health.newNotGreeted).toBe(1);
  });

  it("picks the post with the most likes and comments this week", () => {
    expect(health.topPost).toMatchObject({ likeCount: 2, commentCount: 1, excerpt: "Hello" });
  });

  it("is for managers only", async () => {
    await expect(h.service.getCommunityHealth(m1, communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("setup checklist", () => {
  const free = { importRan: false, payments: null };

  it("ticks steps from community data", async () => {
    const checklist = await h.service.getSetupChecklist(owner, communityId, free);
    const done = Object.fromEntries(checklist.steps.map((step) => [step.key, step.done]));
    expect(done).toEqual({
      import: false,
      branding: false,
      about: false,
      welcome_post: true,
      first_content: true,
      preview: false,
      share: false,
    });
    expect(checklist.doneCount).toBe(2);
  });

  it("records a mark once and keeps the first time", async () => {
    await h.service.markSetupProgress(owner, communityId, "about_previewed");
    const [first] = await h.admin
      .select({ at: communities.aboutPreviewedAt })
      .from(communities)
      .where(eq(communities.id, communityId));
    await h.service.markSetupProgress(adminUser, communityId, "about_previewed");
    const [second] = await h.admin
      .select({ at: communities.aboutPreviewedAt })
      .from(communities)
      .where(eq(communities.id, communityId));
    expect(first?.at?.toISOString()).toBe(now.toISOString());
    expect(second?.at?.toISOString()).toBe(now.toISOString());
    const checklist = await h.service.getSetupChecklist(owner, communityId, free);
    expect(checklist.steps.find((step) => step.key === "preview")?.done).toBe(true);
  });

  it("hides the checklist and records starting fresh", async () => {
    await h.service.markSetupProgress(owner, communityId, "hide");
    await h.service.markSetupProgress(owner, communityId, "skip_import");
    const checklist = await h.service.getSetupChecklist(owner, communityId, free);
    expect(checklist.hidden).toBe(true);
    expect(checklist.steps.find((step) => step.key === "import")?.done).toBe(true);
  });

  it("refuses members", async () => {
    await expect(h.service.getSetupChecklist(m1, communityId, free)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      h.service.markSetupProgress(m1, communityId, "invite_link_copied"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
