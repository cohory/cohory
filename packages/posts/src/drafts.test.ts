import { ApprovalRequiredError, type Actor, type UserActor } from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PostNotFoundError } from "./errors";
import { createPostsService, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

let repo: FakePostsRepository;
let service: PostsService;
let communityId: string;

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function member(role: "member" | "admin" | "owner" = "member"): UserActor {
  const actor: UserActor = { kind: "user", userId: newId(), platformAdmin: false };
  repo.addMember(communityId, actor.userId, role);
  repo.addUser(actor.userId, `${role} person`);
  return actor;
}

function agentOf(owner: UserActor, agentId = newId()): Actor {
  return {
    ...owner,
    credential: {
      type: "agent",
      tokenId: newId(),
      agentId,
      communityId,
      scopes: ["posts:write", "comments:write"],
      via: "api",
    },
  };
}

function personalToken(owner: UserActor): Actor {
  return {
    ...owner,
    credential: {
      type: "user",
      tokenId: newId(),
      agentId: null,
      communityId,
      scopes: ["posts:write"],
      via: "api",
    },
  };
}

beforeEach(() => {
  repo = createFakePostsRepository();
  service = createPostsService({
    repo,
    storage: {
      put: async (i) => ({ key: i.key, contentType: "image/png", size: 1 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("posts created by agents", () => {
  it("wait as drafts with the agent marker and stay out of the feed", async () => {
    const owner = member("admin");
    const agent = agentOf(owner);

    const result = await service.createPost(agent, communityId, {
      title: "Monday",
      body: body("Draft announcement"),
    });

    expect(result.post.status).toBe("draft");
    expect(result.post.agent?.id).toBe(
      agent.kind === "user" ? agent.credential?.agentId : undefined,
    );
    expect(result.post.author.id).toBe(owner.userId);
    expect(result.events).toEqual([]);
    expect(repo.posts.size).toBe(0);
    expect((await service.listFeed(owner, communityId)).data).toEqual([]);
  });

  it("publish directly when a person uses a personal token", async () => {
    const owner = member();

    const { post } = await service.createPost(personalToken(owner), communityId, {
      body: body("Hello"),
    });

    expect(post.status).toBe("published");
    expect(post.agent).toBeNull();
  });

  it("are listed for the owner and published by a person with the agent marker kept", async () => {
    const owner = member("admin");
    const agentId = newId();
    const { post: draft } = await service.createPost(agentOf(owner, agentId), communityId, {
      body: body("Ready"),
    });

    expect((await service.listDrafts(owner, communityId)).map((d) => d.id)).toEqual([draft.id]);
    const published = await service.publishDraft(owner, communityId, draft.id);

    expect(published.post.status).toBe("published");
    expect(published.post.agent?.id).toBe(agentId);
    expect(published.post.author.id).toBe(owner.userId);
    expect(published.events.map((event) => event.type)).toContain("post.created");
    expect(await service.listDrafts(owner, communityId)).toEqual([]);
    expect((await service.listFeed(owner, communityId)).data.map((p) => p.id)).toEqual([
      published.post.id,
    ]);
  });

  it("cannot be published or discarded by the agent itself", async () => {
    const owner = member("admin");
    const agent = agentOf(owner);
    const { post: draft } = await service.createPost(agent, communityId, { body: body("x") });

    await expect(service.publishDraft(agent, communityId, draft.id)).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    await expect(service.discardDraft(agent, communityId, draft.id)).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
  });

  it("are hidden from other members and visible to managers", async () => {
    const owner = member("admin");
    const { post: draft } = await service.createPost(agentOf(owner), communityId, {
      body: body("x"),
    });
    const other = member();
    const manager = member("owner");

    expect(await service.listDrafts(other, communityId)).toEqual([]);
    await expect(service.publishDraft(other, communityId, draft.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect((await service.listDrafts(manager, communityId)).map((d) => d.id)).toEqual([draft.id]);
    await service.discardDraft(manager, communityId, draft.id);
    expect(await service.listDrafts(owner, communityId)).toEqual([]);
  });

  it("show an agent only its own drafts", async () => {
    const owner = member("admin");
    const first = agentOf(owner);
    const second = agentOf(owner);
    await service.createPost(first, communityId, { body: body("one") });
    await service.createPost(second, communityId, { body: body("two") });

    expect((await service.listDrafts(first, communityId)).map((d) => d.excerpt)).toEqual(["one"]);
  });
});

describe("comments created by agents", () => {
  it("are published at once and carry the agent marker", async () => {
    const owner = member("admin");
    const { post } = await service.createPost(owner, communityId, { body: body("Post") });
    const agentId = newId();

    const { comment } = await service.createComment(agentOf(owner, agentId), communityId, post.id, {
      body: body("Agent reply"),
    });

    expect(comment.agent?.id).toBe(agentId);
    expect(comment.author.id).toBe(owner.userId);
  });

  it("cannot delete content, which needs approval", async () => {
    const owner = member("admin");
    const { post } = await service.createPost(owner, communityId, { body: body("Post") });

    await expect(service.deletePost(agentOf(owner), communityId, post.id)).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
  });
});

describe("scheduled posts and agents", () => {
  const later = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  it("refuses an agent post with a publish date instead of skipping the draft", async () => {
    const owner = member("admin");

    await expect(
      service.createPost(agentOf(owner), communityId, { body: body("x"), scheduledAt: later() }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(repo.posts.size).toBe(0);
    expect(repo.drafts.size).toBe(0);
  });

  it("refuses an agent rescheduling or publishing its owner's scheduled post", async () => {
    const owner = member("admin");
    const { post } = await service.createPost(owner, communityId, {
      body: body("Scheduled by a person"),
      scheduledAt: later(),
    });

    await expect(
      service.updateScheduledPost(agentOf(owner), communityId, post.id, {
        scheduledAt: later(),
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    await expect(
      service.publishScheduledPost(agentOf(owner), communityId, post.id),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("carries the agent id on the post.created event when a person publishes an agent draft", async () => {
    const owner = member("admin");
    const agentId = newId();
    const { post: draft } = await service.createPost(agentOf(owner, agentId), communityId, {
      body: body("x"),
    });

    const published = await service.publishDraft(owner, communityId, draft.id);

    expect(published.events.find((event) => event.type === "post.created")?.payload).toMatchObject({
      agentId,
    });
  });
});
