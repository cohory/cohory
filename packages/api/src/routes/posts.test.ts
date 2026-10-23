import type { CommunityRole } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let communitiesRepo: ReturnType<typeof createFakeRepository>;
let postsRepo: ReturnType<typeof createFakePostsRepository>;
let api: ReturnType<typeof createApi>;

function addCommunity(slug: string, privacy: "public" | "private" = "private"): string {
  const community = communitiesRepo.addCommunity({
    slug: communitySlugSchema.parse(slug),
    privacy,
  });
  postsRepo.addCommunity(community.id, privacy);
  return community.id;
}

function addMember(communityId: string, role: CommunityRole = "member"): string {
  const userId = newId();
  communitiesRepo.addMembership({ communityId, userId, role });
  postsRepo.addMember(communityId, userId, role);
  postsRepo.addUser(userId, `${role} person`);
  return userId;
}

beforeEach(() => {
  communitiesRepo = createFakeRepository();
  postsRepo = createFakePostsRepository();
  const communities = createCommunitiesService(communitiesRepo);
  const posts = createPostsService({
    repo: postsRepo,
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  api = createApi(() => apiDeps({ resolveSession, communities, posts }));
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown; form?: FormData } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

async function createPost(userId: string, text = "Hello"): Promise<{ id: string }> {
  const response = await call("/makers/posts", {
    method: "POST",
    userId,
    body: { title: "Hi", body: doc(text) },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

describe("posts routes", () => {
  let communityId: string;
  let owner: string;
  let member: string;

  beforeEach(() => {
    communityId = addCommunity("makers");
    owner = addMember(communityId, "owner");
    member = addMember(communityId);
  });

  it("answers 409 community_archived for writes to an archived community and keeps reads", async () => {
    const post = await createPost(member);
    postsRepo.archiveCommunity(communityId);

    const write = await call("/makers/posts", {
      method: "POST",
      userId: member,
      body: { body: doc("Late") },
    });
    const like = await call(`/makers/posts/${post.id}/like`, { method: "POST", userId: member });
    const read = await call("/makers/posts", { userId: member });

    expect(write.status).toBe(409);
    expect(await errorCode(write)).toBe("community_archived");
    expect(like.status).toBe(409);
    expect(read.status).toBe(200);
  });

  it("answers 429 with Retry-After when a member posts too often", async () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, post: { max: 1, windowSeconds: 30 } },
    });
    const limited = createApi(() =>
      apiDeps({
        resolveSession,
        communities: createCommunitiesService(communitiesRepo),
        posts: createPostsService({
          repo: postsRepo,
          storage: {
            put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
            publicUrl: (key) => `/files/${key}`,
          },
          rateLimit: (rule, userId) => limiter.consume(rule, userId),
        }),
      }),
    );
    const post = () =>
      limited.request("/api/v1/communities/makers/posts", {
        method: "POST",
        headers: { [sessionHeader]: member, "content-type": "application/json" },
        body: JSON.stringify({ body: doc("Hi") }),
      });

    expect((await post()).status).toBe(201);
    const refused = await post();

    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("30");
    expect(await errorCode(refused)).toBe("rate_limited");
  });

  it("creates a post and lists it in the feed", async () => {
    const post = await createPost(member, "<script>x</script>");

    const response = await call("/makers/posts", { userId: owner });

    expect(response.status).toBe(200);
    const page = (await response.json()) as { data: unknown[]; nextCursor: string | null };
    expect(page.nextCursor).toBeNull();
    expect(page.data).toEqual([
      expect.objectContaining({
        id: post.id,
        title: "Hi",
        bodyHtml: "<p>&lt;script&gt;x&lt;/script&gt;</p>",
        author: { id: member, name: "member person", image: null },
        likeCount: 0,
        commentCount: 0,
        viewerHasLiked: false,
        pinnedAt: null,
        createdAt: expect.stringMatching(/Z$/),
      }),
    ]);
  });

  it("answers 401 for a signed out write and 403 for a non member", async () => {
    const signedOut = await call("/makers/posts", { method: "POST", body: { body: doc("x") } });
    const outsider = await call("/makers/posts", {
      method: "POST",
      userId: newId(),
      body: { body: doc("x") },
    });

    expect(signedOut.status).toBe(401);
    expect(await errorCode(signedOut)).toBe("unauthenticated");
    expect(outsider.status).toBe(403);
    expect(await errorCode(outsider)).toBe("forbidden");
  });

  it("answers 403 to a guest reading a private feed and 200 for a public one", async () => {
    addCommunity("open-house", "public");

    expect((await call("/makers/posts")).status).toBe(403);
    expect((await call("/open-house/posts")).status).toBe(200);
  });

  it("answers 404 for an unknown community, post, or comment", async () => {
    expect((await call("/nowhere/posts", { userId: member })).status).toBe(404);
    const missingPost = await call(`/makers/posts/${newId()}`, { userId: member });
    expect(missingPost.status).toBe(404);
    expect(await errorCode(missingPost)).toBe("not_found");
    const missingComment = await call(`/makers/comments/${newId()}`, {
      method: "PATCH",
      userId: member,
      body: { body: doc("x") },
    });
    expect(missingComment.status).toBe(404);
  });

  it("answers 422 with details for invalid content and malformed ids", async () => {
    const unsafe = await call("/makers/posts", {
      method: "POST",
      userId: member,
      body: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "x",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(unsafe.status).toBe(422);
    const body = (await unsafe.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.length).toBeGreaterThan(0);

    expect((await call("/makers/posts/not-a-uuid", { userId: member })).status).toBe(422);
    expect((await call("/makers/posts?limit=500", { userId: member })).status).toBe(422);
  });

  it("edits, pins, likes, and deletes a post with the right statuses", async () => {
    const post = await createPost(member);

    const edited = await call(`/makers/posts/${post.id}`, {
      method: "PATCH",
      userId: member,
      body: { title: "Edited" },
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ title: "Edited", editedAt: expect.any(String) });

    const notAuthor = await call(`/makers/posts/${post.id}`, {
      method: "PATCH",
      userId: owner,
      body: { title: "Owner edit" },
    });
    expect(notAuthor.status).toBe(403);

    expect(
      (await call(`/makers/posts/${post.id}/pin`, { method: "POST", userId: member })).status,
    ).toBe(403);
    const pinned = await call(`/makers/posts/${post.id}/pin`, { method: "POST", userId: owner });
    expect(await pinned.json()).toMatchObject({ pinnedAt: expect.any(String) });
    const unpinned = await call(`/makers/posts/${post.id}/pin`, {
      method: "DELETE",
      userId: owner,
    });
    expect(await unpinned.json()).toMatchObject({ pinnedAt: null });

    const like = await call(`/makers/posts/${post.id}/like`, { method: "POST", userId: owner });
    expect(await like.json()).toEqual({ liked: true, likeCount: 1 });
    const unlike = await call(`/makers/posts/${post.id}/like`, { method: "DELETE", userId: owner });
    expect(await unlike.json()).toEqual({ liked: false, likeCount: 0 });

    expect(
      (await call(`/makers/posts/${post.id}`, { method: "DELETE", userId: owner })).status,
    ).toBe(204);
    expect((await call(`/makers/posts/${post.id}`, { userId: member })).status).toBe(404);
    const deleted = await call(`/makers/posts/${post.id}`, { userId: owner });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      deletion: { at: expect.stringMatching(/Z$/), by: { id: owner, name: "owner person" } },
    });
  });

  it("answers 409 when a fourth post is pinned", async () => {
    const posts = [];
    for (let i = 0; i < 4; i += 1) posts.push(await createPost(owner, `p${i}`));
    for (const post of posts.slice(0, 3)) {
      await call(`/makers/posts/${post.id}/pin`, { method: "POST", userId: owner });
    }

    const response = await call(`/makers/posts/${posts[3]?.id}/pin`, {
      method: "POST",
      userId: owner,
    });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("pin_limit_reached");
  });

  it("creates threaded comments, likes, edits, and deletes them", async () => {
    const post = await createPost(member);
    const top = await call(`/makers/posts/${post.id}/comments`, {
      method: "POST",
      userId: owner,
      body: { body: doc("top") },
    });
    expect(top.status).toBe(201);
    const topComment = (await top.json()) as { id: string };
    const reply = await call(`/makers/posts/${post.id}/comments`, {
      method: "POST",
      userId: member,
      body: { body: doc("reply"), parentId: topComment.id },
    });
    const replyComment = (await reply.json()) as { id: string };

    const nested = await call(`/makers/posts/${post.id}/comments`, {
      method: "POST",
      userId: member,
      body: { body: doc("nested"), parentId: replyComment.id },
    });
    expect(nested.status).toBe(422);
    expect(await errorCode(nested)).toBe("invalid_parent");

    const liked = await call(`/makers/comments/${replyComment.id}/like`, {
      method: "POST",
      userId: owner,
    });
    expect(await liked.json()).toEqual({ liked: true, likeCount: 1 });

    const edited = await call(`/makers/comments/${replyComment.id}`, {
      method: "PATCH",
      userId: member,
      body: { body: doc("changed") },
    });
    expect(await edited.json()).toMatchObject({ bodyHtml: "<p>changed</p>" });

    const list = await call(`/makers/posts/${post.id}/comments`, { userId: member });
    expect(await list.json()).toMatchObject({
      data: [{ id: topComment.id, replies: [{ id: replyComment.id, likeCount: 1 }] }],
      nextCursor: null,
    });

    const removed = await call(`/makers/comments/${topComment.id}`, {
      method: "DELETE",
      userId: member,
    });
    expect(removed.status).toBe(403);
    expect(
      (await call(`/makers/comments/${topComment.id}`, { method: "DELETE", userId: owner })).status,
    ).toBe(204);
    expect(
      await (await call(`/makers/posts/${post.id}/comments`, { userId: member })).json(),
    ).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it("uploads a post image as multipart form data", async () => {
    const form = new FormData();
    form.set("file", new File([pngBytes], "photo.png", { type: "image/png" }));

    const response = await call("/makers/uploads/post-image", {
      method: "POST",
      userId: member,
      form,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { key: string; url: string };
    expect(body.key).toMatch(new RegExp(`^communities/${communityId}/posts/.+\\.png$`));
    expect(body.url).toBe(`/files/${body.key}`);
  });

  it("rejects an upload that is not a real image or has no file", async () => {
    const fake = new FormData();
    fake.set("file", new File(["<svg/>"], "x.png", { type: "image/png" }));
    const empty = new FormData();
    empty.set("note", "no file");

    const mismatch = await call("/makers/uploads/post-image", {
      method: "POST",
      userId: member,
      form: fake,
    });
    const missing = await call("/makers/uploads/post-image", {
      method: "POST",
      userId: member,
      form: empty,
    });
    const outsider = new FormData();
    outsider.set("file", new File([pngBytes], "photo.png", { type: "image/png" }));
    const forbidden = await call("/makers/uploads/post-image", {
      method: "POST",
      userId: newId(),
      form: outsider,
    });

    expect(mismatch.status).toBe(422);
    expect(await errorCode(mismatch)).toBe("content_mismatch");
    expect(missing.status).toBe(422);
    expect(forbidden.status).toBe(403);
  });
});
