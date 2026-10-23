import { LimitReachedError } from "@cohory/fair-use";
import {
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
} from "@cohory/authz";
import { CommunityArchivedError } from "@cohory/communities/archive";
import { createRateLimiter, rateLimitDefaults, RateLimitedError } from "@cohory/rate-limit";
import { newId } from "@cohory/db";
import { StorageError, type PutObjectInput } from "@cohory/storage";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CommentNotFoundError,
  InvalidParentCommentError,
  PinLimitError,
  PostNotFoundError,
  PostsCommunityNotFoundError,
  PostValidationError,
} from "./errors";
import { createPostsService, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let repo: FakePostsRepository;
let service: PostsService;
let stored: PutObjectInput[];
let communityId: string;
let clock: number;

const guest: Actor = { kind: "guest" };

function user(userId = newId()): Actor & { kind: "user" } {
  return { kind: "user", userId, platformAdmin: false };
}

function member(role: CommunityRole = "member", inCommunity = communityId) {
  const actor = user();
  repo.addMember(inCommunity, actor.userId, role);
  repo.addUser(actor.userId, `${role} person`);
  return actor;
}

function body(text: string, ...extra: unknown[]): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...extra],
  };
}

function mention(id: string, label: string): unknown {
  return { type: "paragraph", content: [{ type: "mention", attrs: { id, label } }] };
}

beforeEach(() => {
  repo = createFakePostsRepository();
  stored = [];
  clock = Date.UTC(2026, 9, 1);
  service = createPostsService({
    repo,
    storage: {
      async put(input) {
        stored.push(input);
        return { key: input.key, contentType: "image/png", size: input.body.byteLength };
      },
      publicUrl: (key) => `/files/${key}`,
    },
    now: () => new Date((clock += 1000)),
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("createPost", () => {
  it("creates a post with rendered html, an excerpt, and the author summary", async () => {
    const author = member();

    const { post } = await service.createPost(author, communityId, {
      title: "  Hello  ",
      body: body("First <b>post</b>"),
    });

    expect(post).toMatchObject({
      title: "Hello",
      bodyHtml: "<p>First &lt;b&gt;post&lt;/b&gt;</p>",
      excerpt: "First <b>post</b>",
      author: { id: author.userId, name: "member person" },
      likeCount: 0,
      commentCount: 0,
      viewerHasLiked: false,
      pinnedAt: null,
      editedAt: null,
    });
  });

  it("stores an empty title as null", async () => {
    const { post } = await service.createPost(member(), communityId, {
      title: "",
      body: body("x"),
    });

    expect(post.title).toBeNull();
  });

  it("resolves mentions of active members only, drops the others, and skips the author", async () => {
    const author = member();
    const mentioned = member();
    const outsider = user();
    const banned = user();
    repo.addMember(communityId, banned.userId, "member", "banned");

    const result = await service.createPost(author, communityId, {
      body: body(
        "hi",
        mention(mentioned.userId, "Ada"),
        mention(outsider.userId, "Out"),
        mention(banned.userId, "Ban"),
        mention(author.userId, "Me"),
      ),
    });

    expect(result.mentionedUserIds).toEqual([mentioned.userId]);
    expect(result.post.bodyHtml).toContain(`data-mention-id="${mentioned.userId}"`);
    expect(result.post.bodyHtml).not.toContain(outsider.userId);
    expect(result.post.bodyHtml).toContain("<p>@Out</p>");
    expect(result.events.map((event) => event.type)).toEqual(["post.created", "mention.created"]);
  });

  it("accepts images uploaded under this community's posts folder", async () => {
    const key = `communities/${communityId}/posts/${newId()}.png`;

    const { post } = await service.createPost(member(), communityId, {
      body: body("look", { type: "image", attrs: { key, width: 4, height: 3 } }),
    });

    expect(post.images).toEqual([{ key, url: `/files/${key}`, width: 4, height: 3 }]);
  });

  it.each([
    (other: string) => `communities/${other}/posts/a.png`,
    (_: string, own: string) => `communities/${own}/covers/a.png`,
    (_: string, own: string) => `communities/${own}/posts/../x.png`,
    (_: string, own: string) => `communities/${own}/posts/a.exe`,
    () => "users/x/avatar.png",
  ])("rejects an image key outside the community posts folder (%#)", async (build) => {
    const key = build(newId(), communityId);

    await expect(
      service.createPost(member(), communityId, {
        body: body("x", { type: "image", attrs: { key } }),
      }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("rejects a title over 120 characters and invalid content", async () => {
    await expect(
      service.createPost(member(), communityId, { title: "t".repeat(121), body: body("x") }),
    ).rejects.toBeInstanceOf(PostValidationError);
    await expect(
      service.createPost(member(), communityId, { body: "<p>raw html</p>" }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("requires a signed in active member", async () => {
    const pending = user();
    repo.addMember(communityId, pending.userId, "member", "pending");

    await expect(
      service.createPost(guest, communityId, { body: body("x") }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      service.createPost(user(), communityId, { body: body("x") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.createPost(pending, communityId, { body: body("x") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("answers not found for an unknown or malformed community id", async () => {
    await expect(service.createPost(member(), newId(), { body: body("x") })).rejects.toBeInstanceOf(
      PostsCommunityNotFoundError,
    );
    await expect(
      service.createPost(member(), "not-a-uuid", { body: body("x") }),
    ).rejects.toBeInstanceOf(PostsCommunityNotFoundError);
  });
});

describe("updatePost and deletePost", () => {
  it("lets the author edit and marks the post as edited", async () => {
    const author = member();
    const { post } = await service.createPost(author, communityId, { title: "A", body: body("x") });

    const updated = await service.updatePost(author, communityId, post.id, { body: body("new") });

    expect(updated).toMatchObject({ title: "A", bodyHtml: "<p>new</p>", excerpt: "new" });
    expect(updated.editedAt).toBeInstanceOf(Date);
  });

  it.each(["moderator", "admin", "owner", "member"] as const)(
    "does not let a %s edit someone else's post",
    async (role) => {
      const { post } = await service.createPost(member(), communityId, { body: body("x") });

      await expect(
        service.updatePost(member(role), communityId, post.id, { title: "Mine now" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it.each(["moderator", "admin", "owner"] as const)(
    "lets a %s delete someone else's post",
    async (role) => {
      const { post } = await service.createPost(member(), communityId, { body: body("x") });

      await service.deletePost(member(role), communityId, post.id);

      expect(repo.posts.get(post.id)?.deletedAt).toBeInstanceOf(Date);
    },
  );

  it("does not let a member delete someone else's post", async () => {
    const { post } = await service.createPost(member(), communityId, { body: body("x") });

    await expect(service.deletePost(member(), communityId, post.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("hides a soft deleted post from the feed, reads, edits, and likes", async () => {
    const author = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });

    await service.deletePost(author, communityId, post.id);

    expect((await service.listFeed(author, communityId)).data).toEqual([]);
    await expect(service.getPost(author, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.updatePost(author, communityId, post.id, { title: "x" }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(
      service.toggleLike(author, communityId, {
        subjectType: "post",
        subjectId: post.id,
        liked: true,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    expect(repo.posts.get(post.id)).toBeDefined();
  });
});

describe("pinning", () => {
  it.each(["admin", "owner"] as const)("lets a %s pin and unpin", async (role) => {
    const { post } = await service.createPost(member(), communityId, { body: body("x") });
    const manager = member(role);

    expect((await service.pinPost(manager, communityId, post.id)).pinnedAt).toBeInstanceOf(Date);
    expect((await service.unpinPost(manager, communityId, post.id)).pinnedAt).toBeNull();
  });

  it.each(["moderator", "member"] as const)("does not let a %s pin", async (role) => {
    const { post } = await service.createPost(member(), communityId, { body: body("x") });

    await expect(service.pinPost(member(role), communityId, post.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("allows at most three pinned posts and keeps pinning idempotent", async () => {
    const admin = member("admin");
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push((await service.createPost(admin, communityId, { body: body(`p${i}`) })).post.id);
    }
    for (const id of ids.slice(0, 3)) {
      await service.pinPost(admin, communityId, id);
    }

    await expect(service.pinPost(admin, communityId, ids[0] ?? "")).resolves.toBeDefined();
    await expect(service.pinPost(admin, communityId, ids[3] ?? "")).rejects.toBeInstanceOf(
      PinLimitError,
    );
  });

  it("lists pinned posts first, then newest first", async () => {
    const admin = member("admin");
    const first = await service.createPost(admin, communityId, { body: body("first") });
    const second = await service.createPost(admin, communityId, { body: body("second") });
    const third = await service.createPost(admin, communityId, { body: body("third") });
    await service.pinPost(admin, communityId, first.post.id);

    const feed = await service.listFeed(admin, communityId);

    expect(feed.data.map((p) => p.id)).toEqual([first.post.id, third.post.id, second.post.id]);
  });
});

describe("listFeed", () => {
  it("pages through 45 posts without duplicates or gaps", async () => {
    const author = member();
    const created: string[] = [];
    for (let i = 0; i < 45; i += 1) {
      created.push(
        (await service.createPost(author, communityId, { body: body(`n${i}`) })).post.id,
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await service.listFeed(author, communityId, { cursor });
      seen.push(...page.data.map((p) => p.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual([...created].reverse());
  });

  it("lets a guest read the feed of a public community but not a private one", async () => {
    const open = repo.addCommunity(newId(), "public").id;
    await service.createPost(member("member", open), open, { body: body("hello") });

    expect((await service.listFeed(guest, open)).data).toHaveLength(1);
    await expect(service.listFeed(guest, communityId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listFeed(user(), communityId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a tampered cursor", async () => {
    await expect(
      service.listFeed(member(), communityId, { cursor: "bm90LWpzb24" }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("never returns another community's post, even with a forged id", async () => {
    const other = repo.addCommunity(newId(), "private").id;
    const outsider = member("owner", other);
    const { post } = await service.createPost(outsider, other, { body: body("secret") });
    const reader = member();

    expect((await service.listFeed(reader, communityId)).data).toEqual([]);
    await expect(service.getPost(reader, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.createComment(reader, communityId, post.id, { body: body("x") }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
  });
});

describe("comments", () => {
  async function postBy(actor: Actor) {
    return (await service.createPost(actor, communityId, { body: body("post") })).post;
  }

  it("creates comments and one level of replies, oldest first", async () => {
    const author = member();
    const post = await postBy(author);
    const a = await service.createComment(author, communityId, post.id, { body: body("a") });
    const b = await service.createComment(author, communityId, post.id, { body: body("b") });
    const reply = await service.createComment(author, communityId, post.id, {
      body: body("a1"),
      parentId: a.comment.id,
    });

    const page = await service.listComments(author, communityId, post.id);

    expect(page.data.map((c) => c.id)).toEqual([a.comment.id, b.comment.id]);
    expect(page.data[0]?.replies.map((r) => r.id)).toEqual([reply.comment.id]);
    expect((await service.getPost(author, communityId, post.id)).commentCount).toBe(3);
    expect(reply.events[0]).toMatchObject({
      type: "comment.created",
      payload: {
        parentId: a.comment.id,
        parentAuthorId: author.userId,
        postAuthorId: author.userId,
      },
    });
  });

  it("rejects a reply to a reply and a parent from another post", async () => {
    const author = member();
    const post = await postBy(author);
    const otherPost = await postBy(author);
    const top = await service.createComment(author, communityId, post.id, { body: body("t") });
    const reply = await service.createComment(author, communityId, post.id, {
      body: body("r"),
      parentId: top.comment.id,
    });
    const elsewhere = await service.createComment(author, communityId, otherPost.id, {
      body: body("e"),
    });

    await expect(
      service.createComment(author, communityId, post.id, {
        body: body("x"),
        parentId: reply.comment.id,
      }),
    ).rejects.toBeInstanceOf(InvalidParentCommentError);
    await expect(
      service.createComment(author, communityId, post.id, {
        body: body("x"),
        parentId: elsewhere.comment.id,
      }),
    ).rejects.toBeInstanceOf(InvalidParentCommentError);
  });

  it("rejects images in comments", async () => {
    const author = member();
    const post = await postBy(author);
    const key = `communities/${communityId}/posts/a.png`;

    await expect(
      service.createComment(author, communityId, post.id, {
        body: body("x", { type: "image", attrs: { key } }),
      }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("returns mentioned members from a comment", async () => {
    const author = member();
    const mentioned = member();
    const post = await postBy(author);

    const result = await service.createComment(author, communityId, post.id, {
      body: body("hey", mention(mentioned.userId, "Ada")),
    });

    expect(result.mentionedUserIds).toEqual([mentioned.userId]);
  });

  it("lets only the author edit a comment", async () => {
    const author = member();
    const post = await postBy(author);
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("a"),
    });

    const edited = await service.updateComment(author, communityId, comment.id, {
      body: body("b"),
    });

    expect(edited.bodyHtml).toBe("<p>b</p>");
    expect(edited.editedAt).toBeInstanceOf(Date);
    await expect(
      service.updateComment(member("owner"), communityId, comment.id, { body: body("c") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("soft deletes a comment with its replies and keeps the count right", async () => {
    const author = member();
    const post = await postBy(author);
    const top = await service.createComment(author, communityId, post.id, { body: body("t") });
    await service.createComment(author, communityId, post.id, {
      body: body("r"),
      parentId: top.comment.id,
    });
    await service.createComment(author, communityId, post.id, { body: body("keep") });

    await service.deleteComment(member("moderator"), communityId, top.comment.id);

    const page = await service.listComments(author, communityId, post.id);
    expect(page.data.map((c) => c.bodyHtml)).toEqual(["<p>keep</p>"]);
    expect((await service.getPost(author, communityId, post.id)).commentCount).toBe(1);
    await expect(service.deleteComment(author, communityId, top.comment.id)).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
  });

  it("does not let a member delete someone else's comment", async () => {
    const author = member();
    const post = await postBy(author);
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("a"),
    });

    await expect(service.deleteComment(member(), communityId, comment.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("pages top level comments with a cursor", async () => {
    const author = member();
    const post = await postBy(author);
    for (let i = 0; i < 5; i += 1) {
      await service.createComment(author, communityId, post.id, { body: body(`c${i}`) });
    }

    const first = await service.listComments(author, communityId, post.id, { limit: 3 });
    const second = await service.listComments(author, communityId, post.id, {
      limit: 3,
      cursor: first.nextCursor,
    });

    expect(first.data).toHaveLength(3);
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});

describe("toggleLike", () => {
  it("is idempotent and keeps the count right for posts", async () => {
    const author = member();
    const fan = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const like = { subjectType: "post" as const, subjectId: post.id, liked: true };

    const first = await service.toggleLike(fan, communityId, like);
    const again = await service.toggleLike(fan, communityId, like);

    expect(first).toMatchObject({ liked: true, likeCount: 1 });
    const reactionId = repo.reactions[0]?.id;
    expect(reactionId).toBeDefined();
    expect(first.events).toEqual([
      {
        type: "like.added",
        payload: {
          communityId,
          reactionId,
          subjectType: "post",
          subjectId: post.id,
          postId: post.id,
          subjectAuthorId: author.userId,
          userId: fan.userId,
          occurredAt: expect.any(String),
        },
      },
    ]);
    expect(again).toMatchObject({ liked: true, likeCount: 1, events: [] });
    expect((await service.getPost(fan, communityId, post.id)).viewerHasLiked).toBe(true);

    const off = await service.toggleLike(fan, communityId, { ...like, liked: false });
    const offAgain = await service.toggleLike(fan, communityId, { ...like, liked: false });
    expect(off.likeCount).toBe(0);
    expect(offAgain.likeCount).toBe(0);
    expect(off.events).toEqual([
      {
        type: "like.removed",
        payload: {
          communityId,
          reactionId,
          subjectType: "post",
          subjectId: post.id,
          postId: post.id,
          subjectAuthorId: author.userId,
          userId: fan.userId,
          occurredAt: expect.any(String),
        },
      },
    ]);
    expect(offAgain.events).toEqual([]);
  });

  it("gives a new reaction id to a like that follows an unlike", async () => {
    const author = member();
    const fan = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const like = { subjectType: "post" as const, subjectId: post.id, liked: true };

    const first = await service.toggleLike(fan, communityId, like);
    await service.toggleLike(fan, communityId, { ...like, liked: false });
    const second = await service.toggleLike(fan, communityId, like);

    const ids = [first, second].map((r) =>
      r.events[0]?.type === "like.added" ? r.events[0].payload.reactionId : null,
    );
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).not.toBeNull();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("likes comments and rejects likes from non members", async () => {
    const author = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("c"),
    });
    const like = { subjectType: "comment" as const, subjectId: comment.id, liked: true };

    const first = await service.toggleLike(member(), communityId, like);
    expect(first.likeCount).toBe(1);
    expect(first.events).toEqual([
      expect.objectContaining({
        type: "like.added",
        payload: expect.objectContaining({ subjectId: comment.id, postId: post.id }),
      }),
    ]);
    expect((await service.toggleLike(author, communityId, like)).likeCount).toBe(2);
    await expect(service.toggleLike(user(), communityId, like)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.toggleLike(guest, communityId, like)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("answers not found when liking a missing comment", async () => {
    await expect(
      service.toggleLike(member(), communityId, {
        subjectType: "comment",
        subjectId: newId(),
        liked: true,
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });
});

describe("report events", () => {
  it("announces each new report to the moderators once", async () => {
    const author = member();
    const reporter = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("c"),
    });

    await service.reportPost(reporter, communityId, post.id, { reason: "spam" });
    await service.reportPost(reporter, communityId, post.id, { reason: "spam" });
    await service.reportComment(reporter, communityId, comment.id, { reason: "harassment" });

    const reported = repo.outbox
      .flatMap((row) => row.events)
      .filter((e) => e.type === "report.created");
    expect(reported).toEqual([
      {
        type: "report.created",
        payload: {
          communityId,
          reportId: expect.any(String),
          postId: post.id,
          commentId: null,
          reporterId: reporter.userId,
        },
      },
      {
        type: "report.created",
        payload: {
          communityId,
          reportId: expect.any(String),
          postId: post.id,
          commentId: comment.id,
          reporterId: reporter.userId,
        },
      },
    ]);
  });
});

describe("delete events", () => {
  it("reports the likes on a deleted post and on its live comments", async () => {
    const author = member();
    const fan = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const { comment } = await service.createComment(fan, communityId, post.id, {
      body: body("c"),
    });
    await service.toggleLike(fan, communityId, {
      subjectType: "post",
      subjectId: post.id,
      liked: true,
    });
    await service.toggleLike(author, communityId, {
      subjectType: "comment",
      subjectId: comment.id,
      liked: true,
    });
    const events: unknown[] = [];
    const publishing = createPostsService({
      repo,
      storage: {
        put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
        publicUrl: (k) => k,
      },
      onEvents: async (committed) => {
        events.push(...committed.events);
      },
    });

    await expect(publishing.deletePost(author, communityId, post.id)).resolves.toBeUndefined();

    expect(events).toEqual([
      {
        type: "post.deleted",
        payload: {
          communityId,
          postId: post.id,
          authorId: author.userId,
          occurredAt: expect.any(String),
          likes: expect.arrayContaining([
            {
              reactionId: expect.any(String),
              subjectAuthorId: author.userId,
              userId: fan.userId,
            },
            {
              reactionId: expect.any(String),
              subjectAuthorId: fan.userId,
              userId: author.userId,
            },
          ]),
        },
      },
    ]);
  });

  it("reports the likes on a deleted comment thread", async () => {
    const author = member();
    const fan = member();
    const { post } = await service.createPost(author, communityId, { body: body("x") });
    const top = await service.createComment(author, communityId, post.id, { body: body("t") });
    const reply = await service.createComment(author, communityId, post.id, {
      body: body("r"),
      parentId: top.comment.id,
    });
    for (const subjectId of [top.comment.id, reply.comment.id]) {
      await service.toggleLike(fan, communityId, {
        subjectType: "comment",
        subjectId,
        liked: true,
      });
    }
    const events: unknown[] = [];
    const publishing = createPostsService({
      repo,
      storage: {
        put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
        publicUrl: (k) => k,
      },
      onEvents: async (committed) => {
        events.push(...committed.events);
      },
    });

    await publishing.deleteComment(author, communityId, top.comment.id);

    expect(events).toEqual([
      {
        type: "comment.deleted",
        payload: {
          communityId,
          postId: post.id,
          commentId: top.comment.id,
          authorId: author.userId,
          occurredAt: expect.any(String),
          likes: [
            { reactionId: expect.any(String), subjectAuthorId: author.userId, userId: fan.userId },
            { reactionId: expect.any(String), subjectAuthorId: author.userId, userId: fan.userId },
          ],
        },
      },
    ]);
  });
});

describe("username mentions", () => {
  it("turns @username in plain text into a mention of an active member", async () => {
    const author = member();
    const ada = member();
    repo.setUsername(ada.userId, "ada");

    const result = await service.createPost(author, communityId, {
      body: body("Thanks @Ada and @nobody, mail a@ada.example"),
    });

    expect(result.mentionedUserIds).toEqual([ada.userId]);
    expect(result.post.body.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Thanks " },
        { type: "mention", attrs: { id: ada.userId, label: "ada" } },
        { type: "text", text: " and @nobody, mail a@ada.example" },
      ],
    });
  });

  it("leaves code and links alone", async () => {
    const author = member();
    const ada = member();
    repo.setUsername(ada.userId, "ada");

    const result = await service.createPost(author, communityId, {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "@ada", marks: [{ type: "code" }] },
              {
                type: "text",
                text: " @ada",
                marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              },
            ],
          },
        ],
      },
    });

    expect(result.mentionedUserIds).toEqual([]);
  });
});

describe("uploadPostImage", () => {
  it("checks the fair use guard with the image size before storing it", async () => {
    const checked: Array<[string, number]> = [];
    const guarded = createPostsService({
      repo,
      storage: {
        async put(input) {
          stored.push(input);
          return { key: input.key, contentType: "image/png", size: input.body.byteLength };
        },
        publicUrl: (key) => `/files/${key}`,
      },
      uploadGuard: async (id, bytes) => {
        checked.push([id, bytes]);
        throw new LimitReachedError("storage", 100, 100);
      },
    });

    await expect(
      guarded.uploadPostImage(member(), communityId, {
        bytes: pngBytes,
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(LimitReachedError);
    expect(checked).toEqual([[communityId, pngBytes.byteLength]]);
    expect(stored).toEqual([]);
  });

  it("stores a valid image under the community posts folder", async () => {
    const result = await service.uploadPostImage(member(), communityId, {
      bytes: pngBytes,
      declaredType: "image/png",
    });

    expect(result.key).toMatch(new RegExp(`^communities/${communityId}/posts/[0-9a-f-]+\\.png$`));
    expect(result.url).toBe(`/files/${result.key}`);
    expect(stored.map((s) => s.key)).toEqual([result.key]);
  });

  it("rejects a file that is not the image it claims to be", async () => {
    await expect(
      service.uploadPostImage(member(), communityId, {
        bytes: new TextEncoder().encode("<svg onload=alert(1)>"),
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(stored).toEqual([]);
  });

  it("requires permission to post", async () => {
    await expect(
      service.uploadPostImage(user(), communityId, { bytes: pngBytes, declaredType: "image/png" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("moderator deleted state", () => {
  it("lets moderators and above open a deleted post with who deleted it and when", async () => {
    const author = member();
    const moderator = member("moderator");
    const { post } = await service.createPost(author, communityId, { body: body("Gone") });

    await service.deletePost(moderator, communityId, post.id);

    for (const role of ["moderator", "admin", "owner"] as const) {
      const seen = await service.getPost(member(role), communityId, post.id);
      expect(seen.bodyHtml).toBe("<p>Gone</p>");
      expect(seen.deletion).toEqual({
        at: repo.posts.get(post.id)?.deletedAt,
        by: { id: moderator.userId, name: "moderator person", image: null },
      });
    }
    await expect(service.getPost(member(), communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(service.getPost(author, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect((await service.listFeed(moderator, communityId)).data).toEqual([]);
  });

  it("marks live posts as not deleted", async () => {
    const { post } = await service.createPost(member(), communityId, { body: body("Here") });

    expect(post.deletion).toBeNull();
  });

  it("shows moderators deleted comments in the thread and hides them from members", async () => {
    const author = member();
    const moderator = member("moderator");
    const { post } = await service.createPost(author, communityId, { body: body("Post") });
    const top = await service.createComment(author, communityId, post.id, { body: body("t") });
    await service.createComment(author, communityId, post.id, {
      body: body("r"),
      parentId: top.comment.id,
    });
    await service.createComment(author, communityId, post.id, { body: body("keep") });

    await service.deleteComment(author, communityId, top.comment.id);

    const staffView = await service.listComments(moderator, communityId, post.id);
    expect(staffView.data.map((c) => [c.bodyHtml, c.deletion?.by?.id ?? null])).toEqual([
      ["<p>t</p>", author.userId],
      ["<p>keep</p>", null],
    ]);
    expect(staffView.data[0]?.replies.map((r) => r.deletion?.by?.id)).toEqual([author.userId]);
    const memberView = await service.listComments(member(), communityId, post.id);
    expect(memberView.data.map((c) => c.bodyHtml)).toEqual(["<p>keep</p>"]);
  });

  it("lets moderators read the comments of a deleted post", async () => {
    const author = member();
    const { post } = await service.createPost(author, communityId, { body: body("Post") });
    await service.createComment(author, communityId, post.id, { body: body("c") });
    await service.deletePost(author, communityId, post.id);

    const page = await service.listComments(member("moderator"), communityId, post.id);

    expect(page.data.map((c) => c.bodyHtml)).toEqual(["<p>c</p>"]);
    await expect(service.listComments(member(), communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
  });
});

describe("outbox", () => {
  it("records each write's events in the outbox inside the write and hands the id on", async () => {
    const author = member();
    const fan = member();
    const committed: { outboxId: string; events: readonly unknown[] }[] = [];
    const publishing = createPostsService({
      repo,
      storage: {
        put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
        publicUrl: (k) => k,
      },
      onEvents: async (entry) => {
        committed.push(entry);
      },
    });

    const created = await publishing.createPost(author, communityId, { body: body("x") });
    const like = await publishing.toggleLike(fan, communityId, {
      subjectType: "post",
      subjectId: created.post.id,
      liked: true,
    });
    const repeat = await publishing.toggleLike(fan, communityId, {
      subjectType: "post",
      subjectId: created.post.id,
      liked: true,
    });

    expect(repo.outbox.map((row) => [row.id, row.communityId, row.events])).toEqual([
      [created.outboxId, communityId, created.events],
      [like.outboxId, communityId, like.events],
    ]);
    expect(repeat.outboxId).toBeNull();
    expect(committed).toEqual([
      { outboxId: created.outboxId, events: created.events },
      { outboxId: like.outboxId, events: like.events },
    ]);
  });

  it("writes nothing to the outbox when the write fails", async () => {
    await expect(
      service.createComment(member(), communityId, newId(), { body: body("x") }),
    ).rejects.toBeInstanceOf(PostNotFoundError);

    expect(repo.outbox).toEqual([]);
  });
});

describe("rate limits", () => {
  it("limits posts, comments, and likes per member and writes nothing once refused", async () => {
    const limiter = createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        post: { max: 1, windowSeconds: 60 },
        comment: { max: 1, windowSeconds: 60 },
        reaction: { max: 1, windowSeconds: 60 },
      },
    });
    const limited = createPostsService({
      repo,
      storage: {
        put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
        publicUrl: (k) => k,
      },
      rateLimit: (rule, userId) => limiter.consume(rule, userId),
    });
    const author = member();
    const other = member();

    const { post } = await limited.createPost(author, communityId, { body: body("one") });
    await limited.createComment(author, communityId, post.id, { body: body("c") });
    const like = { subjectType: "post" as const, subjectId: post.id, liked: true };
    await limited.toggleLike(author, communityId, like);

    await expect(
      limited.createPost(author, communityId, { body: body("two") }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      limited.createComment(author, communityId, post.id, { body: body("again") }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      limited.toggleLike(author, communityId, { ...like, liked: false }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(repo.posts.size).toBe(1);
    await expect(
      limited.createPost(other, communityId, { body: body("other member") }),
    ).resolves.toBeTruthy();
  });
});

describe("archived community", () => {
  it("keeps posts and comments readable but rejects every write", async () => {
    const author = member();
    const owner = member("owner");
    const { post } = await service.createPost(author, communityId, { body: body("Before") });
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("Earlier"),
    });
    repo.archiveCommunity(communityId);
    const like = { subjectType: "post" as const, subjectId: post.id, liked: true };

    expect((await service.getPost(author, communityId, post.id)).id).toBe(post.id);
    expect((await service.listFeed(author, communityId, {})).data).toHaveLength(1);
    const writes = [
      () => service.createPost(author, communityId, { body: body("After") }),
      () => service.updatePost(author, communityId, post.id, { body: body("Edit") }),
      () => service.createComment(author, communityId, post.id, { body: body("Late") }),
      () => service.updateComment(author, communityId, comment.id, { body: body("Edit") }),
      () => service.toggleLike(author, communityId, like),
      () => service.pinPost(owner, communityId, post.id),
      () => service.deleteComment(owner, communityId, comment.id),
      () => service.deletePost(owner, communityId, post.id),
      () =>
        service.uploadPostImage(author, communityId, {
          bytes: pngBytes,
          declaredType: "image/png",
        }),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(CommunityArchivedError);
    }
    expect(stored).toEqual([]);
  });
});
