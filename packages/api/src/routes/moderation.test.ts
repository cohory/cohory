import type { CommunityRole } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";
import { createManageStub, type ManageStub } from "../test/manage-stub";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

let communitiesRepo: ReturnType<typeof createFakeRepository>;
let postsRepo: ReturnType<typeof createFakePostsRepository>;
let api: ReturnType<typeof createApi>;
let manage: ManageStub;
let communityId: string;

function addMember(role: CommunityRole = "member"): string {
  const userId = newId();
  communitiesRepo.addMembership({ communityId, userId, role });
  postsRepo.addMember(communityId, userId, role);
  postsRepo.addUser(userId, `${role} person`);
  return userId;
}

beforeEach(() => {
  communitiesRepo = createFakeRepository();
  postsRepo = createFakePostsRepository();
  const community = communitiesRepo.addCommunity({ slug: communitySlugSchema.parse("makers") });
  communityId = community.id;
  postsRepo.addCommunity(community.id);
  const communities = createCommunitiesService(communitiesRepo);
  const posts = createPostsService({
    repo: postsRepo,
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  manage = createManageStub();
  manage.banMember.mockImplementation(async (_actor, _community, userId) => ({
    userId,
    role: "member",
    status: "banned",
  }));
  api = createApi(() => apiDeps({ resolveSession, communities, posts, manage }));
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function createPost(userId: string): Promise<string> {
  const response = await call("/posts", {
    method: "POST",
    userId,
    body: {
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      },
    },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe("moderation routes", () => {
  it("accepts a report from a member and validates the reason", async () => {
    const author = addMember();
    const reporter = addMember();
    const postId = await createPost(author);

    const ok = await call(`/posts/${postId}/report`, {
      method: "POST",
      userId: reporter,
      body: { reason: "spam", note: "Link farm" },
    });
    const invalid = await call(`/posts/${postId}/report`, {
      method: "POST",
      userId: reporter,
      body: { reason: "boring" },
    });
    const signedOut = await call(`/posts/${postId}/report`, {
      method: "POST",
      body: { reason: "spam" },
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "received" });
    expect(invalid.status).toBe(422);
    expect(signedOut.status).toBe(401);
    expect(postsRepo.reports).toHaveLength(1);
  });

  it("lists the queue for moderators and refuses members", async () => {
    const moderator = addMember("moderator");
    const member = addMember();

    const allowed = await call("/manage/reports?status=closed", { userId: moderator });
    const denied = await call("/manage/reports", { userId: member });

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ data: [], nextCursor: null, openCount: 0 });
    expect(denied.status).toBe(403);
  });

  it("dismisses reports and bans the author through the manage service", async () => {
    const author = addMember();
    const reporter = addMember();
    const admin = addMember("admin");
    const postId = await createPost(author);
    await call(`/posts/${postId}/report`, {
      method: "POST",
      userId: reporter,
      body: { reason: "harassment" },
    });

    const ban = await call("/manage/reports/ban", {
      method: "POST",
      userId: admin,
      body: { type: "post", id: postId },
    });
    const dismissAgain = await call("/manage/reports/dismiss", {
      method: "POST",
      userId: admin,
      body: { type: "post", id: postId },
    });

    expect(ban.status).toBe(200);
    expect(await ban.json()).toEqual({ resolved: 1 });
    expect(manage.banMember).toHaveBeenCalledWith(expect.anything(), communityId, author);
    expect(await dismissAgain.json()).toEqual({ resolved: 0 });
  });
});
