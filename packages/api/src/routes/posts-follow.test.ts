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
import { routeScopes } from "../route-meta";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

let communitiesRepo: ReturnType<typeof createFakeRepository>;
let postsRepo: ReturnType<typeof createFakePostsRepository>;
let api: ReturnType<typeof createApi>;
let communityId: string;
let owner: string;
let member: string;

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
  const community = communitiesRepo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  });
  communityId = community.id;
  postsRepo.addCommunity(community.id, "private");
  owner = addMember("owner");
  member = addMember();
  const posts = createPostsService({
    repo: postsRepo,
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(communitiesRepo),
      posts,
    }),
  );
});

function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.request(`/api/v1/communities/makers${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function createPost(userId: string): Promise<string> {
  const response = await call("/posts", {
    method: "POST",
    userId,
    body: { title: "Hi", body: doc("Hello") },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

interface PostJson {
  readonly authorRole: string | null;
  readonly viewerFollows: boolean;
  readonly lastActivityAt: string;
  readonly conversation: {
    readonly recentCommenters: { id: string; name: string }[];
    readonly lastCommentAt: string;
  } | null;
}

describe("post follow, conversation, and staff role fields", () => {
  it("follows and unfollows a post and shows the follow state on the post", async () => {
    const postId = await createPost(owner);

    const followed = await call(`/posts/${postId}/follow`, { method: "PUT", userId: member });
    const seen = (await (await call(`/posts/${postId}`, { userId: member })).json()) as PostJson;
    const unfollowed = await call(`/posts/${postId}/follow`, { method: "DELETE", userId: member });
    const after = (await (await call(`/posts/${postId}`, { userId: member })).json()) as PostJson;

    expect(followed.status).toBe(200);
    expect(await followed.json()).toEqual({ following: true });
    expect(seen.viewerFollows).toBe(true);
    expect(unfollowed.status).toBe(200);
    expect(after.viewerFollows).toBe(false);
  });

  it("refuses to follow without signing in or in a community the caller is not part of", async () => {
    const postId = await createPost(owner);
    const outsider = newId();

    const anonymous = await call(`/posts/${postId}/follow`, { method: "PUT" });
    const stranger = await call(`/posts/${postId}/follow`, { method: "PUT", userId: outsider });

    expect(anonymous.status).toBe(401);
    expect([403, 404]).toContain(stranger.status);
  });

  it("returns the author's staff role, recent commenters, and the last comment time", async () => {
    const postId = await createPost(owner);
    const comment = await call(`/posts/${postId}/comments`, {
      method: "POST",
      userId: member,
      body: { body: doc("Nice") },
    });
    expect(comment.status).toBe(201);
    expect(((await comment.json()) as { authorRole: string | null }).authorRole).toBeNull();

    const feed = (await (await call("/posts", { userId: member })).json()) as {
      data: PostJson[];
    };
    const post = feed.data[0];

    expect(post?.authorRole).toBe("owner");
    expect(post?.conversation?.recentCommenters.map((person) => person.id)).toEqual([member]);
    expect(post?.conversation?.lastCommentAt).toEqual(expect.any(String));
    expect(post?.lastActivityAt).toEqual(expect.any(String));
  });
});

describe("emailing a post to all members", () => {
  it("lets the owner email a post once per 24 hours and shows when it is available again", async () => {
    const postId = await createPost(owner);

    const sent = await call(`/posts/${postId}/email-members`, { method: "POST", userId: owner });
    const again = await call(`/posts/${postId}/email-members`, { method: "POST", userId: owner });
    const status = await call("/member-email", { userId: owner });

    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({ sentAt: expect.any(String) });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("member_email_too_soon");
    expect(await status.json()).toEqual({
      lastSentAt: expect.any(String),
      nextAvailableAt: expect.any(String),
    });
  });

  it("refuses members and keeps the routes session only, so no token or agent can email everyone", async () => {
    const postId = await createPost(member);

    const denied = await call(`/posts/${postId}/email-members`, { method: "POST", userId: member });
    const status = await call("/member-email", { userId: member });

    expect(denied.status).toBe(403);
    expect(status.status).toBe(403);
    expect(routeScopes.emailPostToMembers.scope).toBeNull();
    expect(routeScopes.getMemberEmailStatus.scope).toBeNull();
  });
});
