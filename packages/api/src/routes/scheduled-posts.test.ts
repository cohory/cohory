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

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const now = Date.UTC(2026, 9, 1, 12, 0, 0);

let communitiesRepo: ReturnType<typeof createFakeRepository>;
let postsRepo: ReturnType<typeof createFakePostsRepository>;
let api: ReturnType<typeof createApi>;
let communityId: string;

function addMember(role: CommunityRole = "member"): string {
  const userId = newId();
  communitiesRepo.addMembership({ communityId, userId, role });
  postsRepo.addMember(communityId, userId, role);
  postsRepo.addUser(userId, `${role} person`);
  return userId;
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function later(minutes: number): string {
  return new Date(now + minutes * 60_000).toISOString();
}

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

async function schedule(
  userId: string,
  minutes = 30,
): Promise<{ id: string; scheduledAt: string }> {
  const response = await call("/posts", {
    method: "POST",
    userId,
    body: { title: "Soon", body: doc("Later"), scheduledAt: later(minutes) },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; scheduledAt: string };
}

beforeEach(() => {
  communitiesRepo = createFakeRepository();
  postsRepo = createFakePostsRepository();
  const community = communitiesRepo.addCommunity({ slug: communitySlugSchema.parse("makers") });
  communityId = community.id;
  postsRepo.addCommunity(communityId);
  const communities = createCommunitiesService(communitiesRepo);
  const posts = createPostsService({
    repo: postsRepo,
    storage: { put: () => Promise.reject(new Error("unused")), publicUrl: (key) => key },
    now: () => new Date(now),
  });
  api = createApi(() => apiDeps({ resolveSession, communities, posts }));
});

describe("scheduled posts routes", () => {
  it("schedules a post that stays out of the feed and shows in the scheduled list", async () => {
    const author = addMember();
    const post = await schedule(author);
    expect(post.scheduledAt).toBe(later(30));

    const feed = (await (await call("/posts", { userId: author })).json()) as { data: unknown[] };
    expect(feed.data).toEqual([]);

    const listed = await call("/scheduled-posts", { userId: author });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { data: { id: string }[] }).data.map((p) => p.id)).toEqual([
      post.id,
    ]);
  });

  it("answers 422 for a time in the past", async () => {
    const response = await call("/posts", {
      method: "POST",
      userId: addMember(),
      body: { body: doc("x"), scheduledAt: later(-10) },
    });
    expect(response.status).toBe(422);
  });

  it("reschedules, publishes now, and refuses a second publish with 409", async () => {
    const author = addMember();
    const post = await schedule(author);
    const patched = await call(`/scheduled-posts/${post.id}`, {
      method: "PATCH",
      userId: author,
      body: { scheduledAt: later(120) },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { scheduledAt: string }).scheduledAt).toBe(later(120));

    const published = await call(`/scheduled-posts/${post.id}/publish`, {
      method: "POST",
      userId: author,
    });
    expect(published.status).toBe(200);
    expect(((await published.json()) as { scheduledAt: null }).scheduledAt).toBeNull();

    const again = await call(`/scheduled-posts/${post.id}/publish`, {
      method: "POST",
      userId: author,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "post_not_scheduled",
    );
  });

  it("changes the category of a scheduled post and refuses one from outside the community", async () => {
    const author = addMember();
    const post = await schedule(author);

    const cleared = await call(`/scheduled-posts/${post.id}`, {
      method: "PATCH",
      userId: author,
      body: { categoryId: null },
    });
    const unknown = await call(`/scheduled-posts/${post.id}`, {
      method: "PATCH",
      userId: author,
      body: { categoryId: newId() },
    });

    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { category: unknown }).category).toBeNull();
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(unknown.status).toBeLessThan(500);
  });

  it("lets a moderator cancel but not edit someone else's scheduled post", async () => {
    const post = await schedule(addMember());
    const moderator = addMember("moderator");
    const edit = await call(`/scheduled-posts/${post.id}`, {
      method: "PATCH",
      userId: moderator,
      body: { title: "x" },
    });
    expect(edit.status).toBe(403);
    const cancel = await call(`/scheduled-posts/${post.id}`, {
      method: "DELETE",
      userId: moderator,
    });
    expect(cancel.status).toBe(204);
    expect(postsRepo.posts.has(post.id)).toBe(false);
  });

  it("denies another member cancelling and requires sign in to list", async () => {
    const post = await schedule(addMember());
    const cancel = await call(`/scheduled-posts/${post.id}`, {
      method: "DELETE",
      userId: addMember(),
    });
    expect(cancel.status).toBe(403);
    expect((await call("/scheduled-posts")).status).toBe(401);
  });
});
