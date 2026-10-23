import {
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
} from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PostNotFoundError, PostsCommunityNotFoundError } from "./errors";
import { createPostsService, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

let repo: FakePostsRepository;
let service: PostsService;
let communityId: string;
let clock: number;

function user(userId = newId()): Actor & { kind: "user" } {
  return { kind: "user", userId, platformAdmin: false };
}

function member(role: CommunityRole = "member", inCommunity = communityId) {
  const actor = user();
  repo.addMember(inCommunity, actor.userId, role);
  repo.addUser(actor.userId, `${role} ${actor.userId.slice(-4)}`);
  return actor;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function post(author: Actor = member()) {
  return (await service.createPost(author, communityId, { body: body("Question") })).post;
}

beforeEach(() => {
  repo = createFakePostsRepository();
  clock = Date.UTC(2026, 9, 1);
  service = createPostsService({
    repo,
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
    now: () => new Date((clock += 1000)),
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("following a post", () => {
  it("follows and unfollows a post, and the post shows the viewer's state", async () => {
    const reader = member();
    const { id } = await post();

    expect(await service.followPost(reader, communityId, id)).toEqual({ following: true });
    expect((await service.getPost(reader, communityId, id)).viewerFollows).toBe(true);

    expect(await service.unfollowPost(reader, communityId, id)).toEqual({ following: false });
    expect((await service.getPost(reader, communityId, id)).viewerFollows).toBe(false);
  });

  it.each<CommunityRole>(["member", "moderator", "admin", "owner"])(
    "lets a %s follow a post",
    async (role) => {
      const { id } = await post();
      await expect(service.followPost(member(role), communityId, id)).resolves.toEqual({
        following: true,
      });
    },
  );

  it("follows the post for the commenter after their first comment", async () => {
    const author = member();
    const commenter = member();
    const { id } = await post(author);

    await service.createComment(commenter, communityId, id, { body: body("Me too") });

    expect((await service.getPost(commenter, communityId, id)).viewerFollows).toBe(true);
    expect((await service.getPost(author, communityId, id)).viewerFollows).toBe(false);
  });

  it("refuses a signed out visitor", async () => {
    const { id } = await post();
    await expect(service.followPost({ kind: "guest" }, communityId, id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("refuses a signed in person who is not a member, even in a public community", async () => {
    const publicId = repo.addCommunity(newId(), "public").id;
    const { post: open } = await service.createPost(member("member", publicId), publicId, {
      body: body("Open"),
    });

    await expect(service.followPost(user(), publicId, open.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.follows.size).toBe(0);
  });

  it("refuses a banned member", async () => {
    const banned = user();
    repo.addMember(communityId, banned.userId, "member", "banned");
    const { id } = await post();

    await expect(service.followPost(banned, communityId, id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets a follower who lost access unfollow, and only their own follow", async () => {
    const leaving = member();
    const staying = member();
    const { id } = await post();
    await service.followPost(leaving, communityId, id);
    await service.followPost(staying, communityId, id);
    repo.addMember(communityId, leaving.userId, "member", "banned");

    await expect(service.unfollowPost(leaving, communityId, id)).resolves.toEqual({
      following: false,
    });
    expect([...repo.follows]).toEqual([`${id}:${staying.userId}`]);
  });

  it("refuses a signed out visitor who tries to unfollow", async () => {
    const { id } = await post();
    await expect(service.unfollowPost({ kind: "guest" }, communityId, id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("cannot follow a post of another community through this community", async () => {
    const otherId = repo.addCommunity(newId(), "private").id;
    const { post: elsewhere } = await service.createPost(member("member", otherId), otherId, {
      body: body("Elsewhere"),
    });

    await expect(service.followPost(member(), communityId, elsewhere.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect(repo.follows.size).toBe(0);
  });

  it("cannot follow a scheduled or deleted post", async () => {
    const author = member();
    const { post: later } = await service.createPost(author, communityId, {
      body: body("Later"),
      scheduledAt: new Date(clock + 60 * 60 * 1000),
    });
    const gone = await post(author);
    await service.deletePost(author, communityId, gone.id);

    for (const id of [later.id, gone.id]) {
      await expect(service.followPost(member(), communityId, id)).rejects.toBeInstanceOf(
        PostNotFoundError,
      );
    }
  });

  it("reports an unknown community as not found", async () => {
    await expect(service.followPost(member(), newId(), newId())).rejects.toBeInstanceOf(
      PostsCommunityNotFoundError,
    );
  });
});

describe("feed visits", () => {
  it("reads the last visit without changing it, and records a visit separately", async () => {
    const reader = member();

    expect(await service.getFeedVisit(reader, communityId)).toBeNull();
    expect(await service.getFeedVisit(reader, communityId)).toBeNull();
    expect(repo.feedVisits.size).toBe(0);

    await service.recordFeedVisit(reader, communityId);
    const seen = await service.getFeedVisit(reader, communityId);

    expect(seen).toBeInstanceOf(Date);
    expect(await service.getFeedVisit(reader, communityId)).toEqual(seen);
  });

  it("records and reads nothing for guests and people who are not members", async () => {
    const outsider = user();

    await service.recordFeedVisit({ kind: "guest" }, communityId);
    await service.recordFeedVisit(outsider, communityId);

    expect(repo.feedVisits.size).toBe(0);
    expect(await service.getFeedVisit(outsider, communityId)).toBeNull();
    expect(await service.getFeedVisit({ kind: "guest" }, communityId)).toBeNull();
  });
});

describe("conversation life on feed cards", () => {
  it("lists up to three recent commenters, newest first, with the last comment time", async () => {
    const author = member();
    const { id } = await post(author);
    const people = [member(), member(), member(), member()];
    for (const person of people) {
      await service.createComment(person, communityId, id, { body: body("Hi") });
    }
    await service.createComment(people[0] ?? author, communityId, id, { body: body("Again") });

    const [card] = (await service.listFeed(author, communityId)).data;

    expect(card?.conversation?.recentCommenters.map((c) => c.id)).toEqual([
      people[0]?.userId,
      people[3]?.userId,
      people[2]?.userId,
    ]);
    expect(card?.conversation?.lastCommentAt).toEqual(card?.lastActivityAt);
  });

  it("leaves deleted comments out", async () => {
    const author = member();
    const commenter = member();
    const { id } = await post(author);
    const { comment } = await service.createComment(commenter, communityId, id, {
      body: body("Oops"),
    });
    await service.deleteComment(commenter, communityId, comment.id);

    const [card] = (await service.listFeed(author, communityId)).data;

    expect(card?.conversation).toBeNull();
  });
});

describe("host and staff badges", () => {
  it("shows the staff role of post and comment authors and nothing for members", async () => {
    const owner = member("owner");
    const moderator = member("moderator");
    const regular = member();
    const { id } = await post(owner);
    await service.createComment(moderator, communityId, id, { body: body("Mod here") });
    await service.createComment(regular, communityId, id, { body: body("Member here") });

    const view = await service.getPost(regular, communityId, id);
    const thread = (await service.listComments(regular, communityId, id)).data;

    expect(view.authorRole).toBe("owner");
    expect(thread.map((c) => c.authorRole)).toEqual(["moderator", null]);
  });

  it("drops the badge once the author is no longer an active member", async () => {
    const admin = member("admin");
    const { id } = await post(admin);
    repo.addMember(communityId, admin.userId, "admin", "removed");

    expect((await service.getPost(member(), communityId, id)).authorRole).toBeNull();
  });
});
