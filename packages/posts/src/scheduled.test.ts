import { ForbiddenError, type Actor, type CommunityRole } from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PostNotFoundError, PostNotScheduledError, PostValidationError } from "./errors";
import { createPostsService, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

const minute = 60_000;
const start = Date.UTC(2026, 9, 1, 12, 0, 0);

let repo: FakePostsRepository;
let service: PostsService;
let communityId: string;
let now: number;

function member(role: CommunityRole = "member"): Actor & { kind: "user" } {
  const actor = { kind: "user" as const, userId: newId(), platformAdmin: false };
  repo.addMember(communityId, actor.userId, role);
  repo.addUser(actor.userId, `${role} person`);
  return actor;
}

function body(text: string, ...extra: unknown[]): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...extra],
  };
}

function inMinutes(minutes: number): string {
  return new Date(now + minutes * minute).toISOString();
}

async function schedule(author: Actor, minutes = 30, text = "Monday notes") {
  const { post } = await service.createPost(author, communityId, {
    title: "Weekly",
    body: body(text),
    scheduledAt: inMinutes(minutes),
  });
  return post;
}

beforeEach(() => {
  repo = createFakePostsRepository();
  now = start;
  service = createPostsService({
    repo,
    storage: { put: () => Promise.reject(new Error("unused")), publicUrl: (key) => key },
    now: () => new Date(now),
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("scheduling a post", () => {
  it("stores the post as scheduled without events", async () => {
    const author = member();
    const result = await service.createPost(author, communityId, {
      body: body("Later"),
      scheduledAt: inMinutes(30),
    });
    expect(result.post.scheduledAt?.toISOString()).toBe(inMinutes(30));
    expect(result.events).toEqual([]);
    expect(result.outboxId).toBeNull();
    expect(repo.outbox).toEqual([]);
  });

  it("refuses a time less than a minute ahead or more than a year ahead", async () => {
    const author = member();
    for (const at of [inMinutes(0.5), inMinutes(-5), inMinutes(366 * 24 * 60)]) {
      await expect(
        service.createPost(author, communityId, { body: body("x"), scheduledAt: at }),
      ).rejects.toBeInstanceOf(PostValidationError);
    }
  });

  it("refuses a time without an offset", async () => {
    await expect(
      service.createPost(member(), communityId, {
        body: body("x"),
        scheduledAt: "2026-10-01T13:00:00",
      }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("hides scheduled posts from the feed, search, comments, likes, and other readers", async () => {
    const author = member();
    const reader = member();
    const post = await schedule(author, 30, "Secretword plans");
    expect((await service.listFeed(reader, communityId)).data).toEqual([]);
    expect((await service.listFeed(author, communityId)).data).toEqual([]);
    expect(await service.searchPosts(reader, communityId, "secretword", 10)).toEqual([]);
    await expect(service.getPost(reader, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.createComment(reader, communityId, post.id, { body: body("Hi") }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(
      service.toggleLike(reader, communityId, {
        subjectType: "post",
        subjectId: post.id,
        liked: true,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(
      service.updatePost(author, communityId, post.id, { title: "x" }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
  });

  it("lets the author open their own scheduled post", async () => {
    const author = member();
    const post = await schedule(author);
    expect((await service.getPost(author, communityId, post.id)).scheduledAt).not.toBeNull();
  });
});

describe("listScheduledPosts", () => {
  it.each([
    ["member", false],
    ["moderator", true],
    ["admin", true],
    ["owner", true],
  ] as const)("a %s sees everyone's scheduled posts: %s", async (role, everyone) => {
    const other = member();
    const viewer = member(role);
    await schedule(other, 60);
    const own = await schedule(viewer, 30);
    const listed = await service.listScheduledPosts(viewer, communityId);
    expect(listed.map((post) => post.id)).toEqual(
      everyone ? [own.id, expect.any(String)] : [own.id],
    );
  });

  it("is denied to people outside the community", async () => {
    const outsider = { kind: "user" as const, userId: newId(), platformAdmin: false };
    await expect(service.listScheduledPosts(outsider, communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("updateScheduledPost", () => {
  it("lets the author change the text and time", async () => {
    const author = member();
    const post = await schedule(author);
    const updated = await service.updateScheduledPost(author, communityId, post.id, {
      title: "Moved",
      body: body("New text"),
      scheduledAt: inMinutes(90),
    });
    expect(updated.title).toBe("Moved");
    expect(updated.excerpt).toBe("New text");
    expect(updated.scheduledAt?.toISOString()).toBe(inMinutes(90));
  });

  it("lets the author move the post to another category or none", async () => {
    const author = member();
    const owner = member("owner");
    const news = await service.createCategory(owner, communityId, { name: "News" });
    const post = await schedule(author);

    const moved = await service.updateScheduledPost(author, communityId, post.id, {
      categoryId: news.id,
    });
    expect(moved.category?.id).toBe(news.id);

    const cleared = await service.updateScheduledPost(author, communityId, post.id, {
      categoryId: null,
    });
    expect(cleared.category).toBeNull();
  });

  it("does not let a member move a scheduled post into a staff only category", async () => {
    const author = member();
    const owner = member("owner");
    const staff = await service.createCategory(owner, communityId, {
      name: "Announcements",
      staffOnly: true,
    });
    const post = await schedule(author);

    await expect(
      service.updateScheduledPost(author, communityId, post.id, { categoryId: staff.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.posts.get(post.id)?.categoryId).toBeNull();
  });

  it.each(["moderator", "admin", "owner"] as const)(
    "does not let a %s edit someone else's scheduled post",
    async (role) => {
      const post = await schedule(member());
      await expect(
        service.updateScheduledPost(member(role), communityId, post.id, { title: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it("refuses a post that is already published", async () => {
    const author = member();
    const { post } = await service.createPost(author, communityId, { body: body("Now") });
    await expect(
      service.updateScheduledPost(author, communityId, post.id, { title: "x" }),
    ).rejects.toBeInstanceOf(PostNotScheduledError);
  });
});

describe("cancelScheduledPost", () => {
  it.each([
    ["author", true],
    ["member", false],
    ["moderator", true],
    ["admin", true],
    ["owner", true],
  ] as const)("a %s can cancel: %s", async (who, allowed) => {
    const author = member();
    const post = await schedule(author);
    const actor = who === "author" ? author : member(who);
    const attempt = service.cancelScheduledPost(actor, communityId, post.id);
    if (allowed) {
      await attempt;
      expect(repo.posts.has(post.id)).toBe(false);
      expect(repo.outbox).toEqual([]);
    } else {
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      expect(repo.posts.has(post.id)).toBe(true);
    }
  });
});

describe("publishing", () => {
  it("publishes due posts once with post.created and mention events at publish time", async () => {
    const author = member();
    const mentioned = member();
    const { post } = await service.createPost(author, communityId, {
      body: body("Hello", {
        type: "paragraph",
        content: [{ type: "mention", attrs: { id: mentioned.userId, label: "m" } }],
      }),
      scheduledAt: inMinutes(10),
    });
    expect(await service.publishDuePosts()).toEqual({ published: [], discarded: 0, errors: [] });
    now += 11 * minute;
    const first = await service.publishDuePosts();
    const second = await service.publishDuePosts();
    expect(first.published).toHaveLength(1);
    expect(second.published).toEqual([]);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0]?.events.map((event) => event.type)).toEqual([
      "post.created",
      "mention.created",
    ]);
    const stored = repo.posts.get(post.id);
    expect(stored?.scheduledAt).toBeNull();
    expect(stored?.createdAt.getTime()).toBe(now);
    expect(stored?.lastActivityAt.getTime()).toBe(now);
    expect((await service.listFeed(member(), communityId)).data.map((p) => p.id)).toEqual([
      post.id,
    ]);
  });

  it("discards a due post whose author left the community", async () => {
    const author = member();
    const post = await schedule(author, 5);
    repo.addMember(communityId, author.userId, "member", "removed");
    now += 6 * minute;
    expect(await service.publishDuePosts()).toEqual({ published: [], discarded: 1, errors: [] });
    expect(repo.posts.get(post.id)?.deletedAt).not.toBeNull();
    expect(await service.publishDuePosts()).toEqual({ published: [], discarded: 0, errors: [] });
    expect(repo.outbox).toEqual([]);
  });

  it("discards a due post when the community is archived", async () => {
    const post = await schedule(member(), 5);
    repo.archiveCommunity(communityId);
    now += 6 * minute;
    expect(await service.publishDuePosts()).toEqual({ published: [], discarded: 1, errors: [] });
    expect(repo.posts.get(post.id)?.deletedAt).not.toBeNull();
  });

  it("lets the author publish a scheduled post right away", async () => {
    const author = member();
    const post = await schedule(author, 60);
    const result = await service.publishScheduledPost(author, communityId, post.id);
    expect(result.post.scheduledAt).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(["post.created"]);
    await expect(service.publishScheduledPost(author, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotScheduledError,
    );
  });

  it("does not let staff publish someone else's scheduled post", async () => {
    const post = await schedule(member(), 60);
    await expect(
      service.publishScheduledPost(member("admin"), communityId, post.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
