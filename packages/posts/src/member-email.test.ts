import {
  ApprovalRequiredError,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
} from "@cohory/authz";
import { CommunityArchivedError } from "@cohory/communities/archive";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { MemberEmailTooSoonError, PostNotFoundError } from "./errors";
import { createPostsService, type CommittedPostEvents, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

const hourMs = 60 * 60 * 1000;

let repo: FakePostsRepository;
let service: PostsService;
let published: CommittedPostEvents[];
let communityId: string;
let clock: number;

function user(userId = newId()): Actor & { kind: "user" } {
  return { kind: "user", userId, platformAdmin: false };
}

function member(role: CommunityRole = "member", inCommunity = communityId) {
  const actor = user();
  repo.addMember(inCommunity, actor.userId, role);
  repo.addUser(actor.userId, role);
  return actor;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function postIn(community: string, author: Actor) {
  return (await service.createPost(author, community, { body: body("News") })).post;
}

beforeEach(() => {
  repo = createFakePostsRepository();
  published = [];
  clock = Date.UTC(2026, 9, 1);
  service = createPostsService({
    repo,
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
    now: () => new Date(clock),
    onEvents: async (committed) => {
      published.push(committed);
    },
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("emailing a post to all members", () => {
  it.each<CommunityRole>(["owner", "admin"])(
    "lets the %s email a post and records who sent it and when",
    async (role) => {
      const sender = member(role);
      const post = await postIn(communityId, sender);

      const result = await service.emailPostToMembers(sender, communityId, post.id);

      expect(result.sentAt).toEqual(new Date(clock));
      expect(repo.memberEmails.get(communityId)).toEqual({
        sentAt: new Date(clock),
        sentBy: sender.userId,
      });
      expect(published.flatMap((c) => c.events)).toContainEqual({
        type: "post.emailed",
        payload: {
          communityId,
          postId: post.id,
          sentBy: sender.userId,
          occurredAt: new Date(clock).toISOString(),
        },
      });
    },
  );

  it.each<CommunityRole>(["member", "moderator"])("refuses a %s", async (role) => {
    const sender = member(role);
    const post = await postIn(communityId, sender);

    await expect(service.emailPostToMembers(sender, communityId, post.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.memberEmails.size).toBe(0);
  });

  it("refuses a signed out visitor and a person who is not a member", async () => {
    const post = await postIn(communityId, member("owner"));

    await expect(
      service.emailPostToMembers({ kind: "guest" }, communityId, post.id),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(service.emailPostToMembers(user(), communityId, post.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("asks a human to approve when an agent tries it", async () => {
    const owner = member("owner");
    const post = await postIn(communityId, owner);
    const agent: Actor = {
      ...owner,
      credential: {
        type: "agent",
        tokenId: newId(),
        agentId: newId(),
        communityId,
        scopes: ["posts:write"],
        via: "api",
      },
    };

    await expect(service.emailPostToMembers(agent, communityId, post.id)).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
  });

  it("allows one email per community every 24 hours", async () => {
    const owner = member("owner");
    const admin = member("admin");
    const first = await postIn(communityId, owner);
    const second = await postIn(communityId, admin);
    await service.emailPostToMembers(owner, communityId, first.id);
    const sentAt = clock;

    clock += 23 * hourMs;
    const refused = service.emailPostToMembers(admin, communityId, second.id);
    await expect(refused).rejects.toBeInstanceOf(MemberEmailTooSoonError);
    await expect(refused).rejects.toMatchObject({
      nextAvailableAt: new Date(sentAt + 24 * hourMs),
    });

    clock = sentAt + 24 * hourMs;
    await expect(service.emailPostToMembers(admin, communityId, second.id)).resolves.toMatchObject({
      sentAt: new Date(clock),
    });
  });

  it("counts the 24 hours per community", async () => {
    const otherId = repo.addCommunity(newId(), "private").id;
    const owner = member("owner");
    repo.addMember(otherId, owner.userId, "owner");
    await service.emailPostToMembers(owner, communityId, (await postIn(communityId, owner)).id);

    await expect(
      service.emailPostToMembers(owner, otherId, (await postIn(otherId, owner)).id),
    ).resolves.toBeDefined();
  });

  it("cannot email a post of another community through this community", async () => {
    const otherId = repo.addCommunity(newId(), "private").id;
    const elsewhere = await postIn(otherId, member("owner", otherId));

    await expect(
      service.emailPostToMembers(member("owner"), communityId, elsewhere.id),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    expect(repo.memberEmails.size).toBe(0);
  });

  it("cannot email a scheduled post", async () => {
    const owner = member("owner");
    const { post } = await service.createPost(owner, communityId, {
      body: body("Later"),
      scheduledAt: new Date(clock + hourMs),
    });

    await expect(service.emailPostToMembers(owner, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
  });

  it("refuses while the community is archived", async () => {
    const owner = member("owner");
    const post = await postIn(communityId, owner);
    repo.archiveCommunity(communityId);

    await expect(service.emailPostToMembers(owner, communityId, post.id)).rejects.toBeInstanceOf(
      CommunityArchivedError,
    );
  });
});

describe("member email status", () => {
  it("tells managers when the next email can go out", async () => {
    const owner = member("owner");
    expect(await service.getMemberEmailStatus(owner, communityId)).toEqual({
      lastSentAt: null,
      nextAvailableAt: null,
    });

    await service.emailPostToMembers(owner, communityId, (await postIn(communityId, owner)).id);
    const sentAt = new Date(clock);
    clock += hourMs;

    expect(await service.getMemberEmailStatus(owner, communityId)).toEqual({
      lastSentAt: sentAt,
      nextAvailableAt: new Date(sentAt.getTime() + 24 * hourMs),
    });
  });

  it("hides the status from members", async () => {
    await expect(service.getMemberEmailStatus(member(), communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
