import type { Actor } from "@cohory/authz";
import { newId } from "@cohory/db";
import { createGamificationService } from "@cohory/gamification";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { afterAll, describe, expect, it } from "vitest";

import { MemberNotFoundError, UsernameTakenError } from "./errors";
import { createPostgresMembersRepository } from "./postgres-repository";
import { createMembersService } from "./service";
import { insertCommunity, insertMember, insertUser, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const repo = createPostgresMembersRepository(db);
const members = createMembersService(repo);
const gamification = createGamificationService({ db });

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

const posts = createPostsService({
  repo: createPostgresPostsRepository(db),
  storage: {
    put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
    publicUrl: (key) => key,
  },
  onEvents: async ({ events }) => {
    await gamification.recordPostEvents(events);
  },
});

afterAll(async () => {
  await close();
});

function unique(base: string): string {
  return `${base}-${newId().slice(-8)}`;
}

describe("members directory", () => {
  it("searches by name or username prefix without case and filters by level", async () => {
    const communityId = await insertCommunity(db);
    const viewer = await insertMember(db, communityId, { name: "Viewer" });
    const ada = await insertMember(db, communityId, { name: "Ada Lovelace" });
    const grace = await insertMember(db, communityId, { name: "Grace Hopper" });
    const handle = unique("hopper");
    await members.setUsername(user(grace), { username: handle });
    const { post } = await posts.createPost(user(ada), communityId, { body: doc("Hi") });
    for (const liker of [viewer, grace]) {
      await posts.toggleLike(user(liker), communityId, {
        subjectType: "post",
        subjectId: post.id,
        liked: true,
      });
    }

    const byName = await members.searchMembers(user(viewer), communityId, { query: "aDA" });
    const byUsername = await members.searchMembers(user(viewer), communityId, {
      query: handle.slice(0, 5).toUpperCase(),
    });
    const wildcard = await members.searchMembers(user(viewer), communityId, { query: "%" });
    const levelOne = await members.searchMembers(user(viewer), communityId, { level: 1 });

    expect(byName.data.map((m) => [m.name, m.points, m.role])).toEqual([
      ["Ada Lovelace", 2, "member"],
    ]);
    expect(byName.data[0]?.joinedAt).toBeInstanceOf(Date);
    expect(byUsername.data.map((m) => m.username)).toEqual([handle]);
    expect(wildcard.data).toEqual([]);
    expect(levelOne.data).toHaveLength(3);
  });

  it("pages newest first and leaves out removed members and other communities", async () => {
    const communityId = await insertCommunity(db);
    const other = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    for (let i = 0; i < 4; i += 1) {
      await insertMember(db, communityId);
    }
    await insertMember(db, communityId, { status: "removed" });
    const outsider = await insertMember(db, other);

    const first = await members.searchMembers(user(viewer), communityId, { limit: 3 });
    const second = await members.searchMembers(user(viewer), communityId, {
      limit: 3,
      cursor: first.nextCursor,
    });
    const all = [...first.data, ...second.data];

    expect(all).toHaveLength(5);
    expect(new Set(all.map((m) => m.userId)).size).toBe(5);
    expect(all.map((m) => m.userId)).not.toContain(outsider);
    expect(second.nextCursor).toBeNull();
    const levels = await members.getMemberLevels(user(viewer), communityId, [
      viewer,
      outsider,
      ...all.map((m) => m.userId),
    ]);
    expect(levels.size).toBe(5);
    expect(levels.has(outsider)).toBe(false);
    expect(levels.get(viewer)).toBe(1);
    await expect(
      members.getMemberProfile(user(viewer), communityId, outsider),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    await expect(members.searchMembers(user(outsider), communityId, {})).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });
});

describe("member full text search", () => {
  it("finds active members by name or by bio, name matches first, in this community only", async () => {
    const communityId = await insertCommunity(db);
    const other = await insertCommunity(db);
    const viewer = await insertMember(db, communityId, { name: "Viewer" });
    const byName = await insertMember(db, communityId, { name: "Quillon Smith" });
    const byBio = await insertMember(db, communityId, { name: "Bea" });
    await members.updateMyProfile(user(byBio), communityId, { bio: "I collect quillon daggers" });
    await insertMember(db, communityId, { name: "Quillon Gone", status: "removed" });
    await insertMember(db, other, { name: "Quillon Elsewhere" });

    const found = await members.findMembers(user(viewer), communityId, "quillon", 10);

    expect(found.map((m) => m.userId)).toEqual([byName, byBio]);
    expect(found[0]?.bioExcerpt).toEqual([]);
    expect(found[1]?.bioExcerpt.length).toBeGreaterThan(0);
  });
});

describe("member profile", () => {
  it("shows bio, points, and recent activity in this community only", async () => {
    const communityId = await insertCommunity(db);
    const other = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    const ada = await insertMember(db, communityId, { name: "Ada" });
    await insertMember(db, other).then(() => undefined);
    await members.updateMyProfile(user(ada), communityId, { bio: "Writes notes" });
    const first = await posts.createPost(user(ada), communityId, { title: "One", body: doc("a") });
    const second = await posts.createPost(user(viewer), communityId, { body: doc("b") });
    const reply = await posts.createComment(user(ada), communityId, second.post.id, {
      body: doc("Nice"),
    });
    const gone = await posts.createPost(user(ada), communityId, { body: doc("gone") });
    await posts.deletePost(user(ada), communityId, gone.post.id);
    await posts.toggleLike(user(viewer), communityId, {
      subjectType: "comment",
      subjectId: reply.comment.id,
      liked: true,
    });

    const profile = await members.getMemberProfile(user(viewer), communityId, ada);

    expect(profile).toMatchObject({ name: "Ada", bio: "Writes notes", points: 1, level: 1 });
    expect(profile.recentActivity.posts.map((p) => p.id)).toEqual([first.post.id]);
    expect(profile.recentActivity.comments).toEqual([
      {
        id: reply.comment.id,
        postId: second.post.id,
        excerpt: "Nice",
        createdAt: expect.any(Date),
      },
    ]);
  });
});

describe("usernames", () => {
  it("are unique without regard to case", async () => {
    const first = await insertUser(db);
    const second = await insertUser(db);
    const name = unique("case");

    await members.setUsername(user(first), { username: name });

    await expect(members.setUsername(user(second), { username: name })).rejects.toBeInstanceOf(
      UsernameTakenError,
    );
    expect(await repo.setUsername(second, name.toUpperCase())).toBe("taken");
  });

  it("let posts link @username mentions to active members", async () => {
    const communityId = await insertCommunity(db);
    const author = await insertMember(db, communityId);
    const ada = await insertMember(db, communityId);
    const handle = unique("ada");
    await members.setUsername(user(ada), { username: handle });

    const created = await posts.createPost(user(author), communityId, {
      body: doc(`Hello @${handle.toUpperCase()}`),
    });

    expect(created.mentionedUserIds).toEqual([ada]);
  });
});
