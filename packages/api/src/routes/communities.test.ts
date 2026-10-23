import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema } from "@cohory/db";
import { parseFairUseEnv } from "@cohory/fair-use";
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

const ownerId = "0192f0a0-0000-7000-8000-00000000000a";
const memberId = "0192f0a0-0000-7000-8000-00000000000b";

let repo: ReturnType<typeof createFakeRepository>;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  repo = createFakeRepository();
  const communities = createCommunitiesService(repo);
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
  });
  api = createApi(() => apiDeps({ resolveSession, communities, posts }));
});

function request(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.request(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function createAsOwner(body: Record<string, unknown>): Promise<Response> {
  return request("/communities", { method: "POST", userId: ownerId, body });
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return body.error;
}

describe("POST /api/v1/communities", () => {
  it("creates a community owned by the signed in person", async () => {
    const response = await createAsOwner({ name: "Makers", slug: "makers", privacy: "public" });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      community: { slug: "makers", name: "Makers", privacy: "public", description: null },
      membership: { userId: ownerId, role: "owner", status: "active" },
    });
  });

  it("answers 401 without a session", async () => {
    const response = await request("/communities", {
      method: "POST",
      body: { name: "Makers", slug: "makers" },
    });

    expect(response.status).toBe(401);
    expect(await errorOf(response)).toMatchObject({ code: "unauthenticated" });
  });

  it("answers 409 when the slug is taken", async () => {
    await createAsOwner({ name: "Makers", slug: "makers" });

    const response = await createAsOwner({ name: "Other", slug: "makers" });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "slug_taken" });
  });

  describe("when only operators may create communities", () => {
    function restrictedApi() {
      const communities = createCommunitiesService(repo, {
        communityCreation: { mode: "operators", operators: ["owner@example.com"] },
      });
      const posts = createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (key) => key,
        },
      });
      return createApi(() => apiDeps({ resolveSession, communities, posts }));
    }

    function create(userId: string) {
      return restrictedApi().request("/api/v1/communities", {
        method: "POST",
        headers: { [sessionHeader]: userId, "content-type": "application/json" },
        body: JSON.stringify({ name: "Makers", slug: "makers" }),
      });
    }

    it("answers 403 with a stable code for a person who is not an operator", async () => {
      repo.addUser(memberId, "Mia", undefined, "member@example.com");

      const response = await create(memberId);

      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({
        code: "community_creation_restricted",
        message: "Only the people who run this server can create communities.",
      });
    });

    it("creates the community for a listed operator", async () => {
      repo.addUser(ownerId, "Olga", undefined, "owner@example.com");

      const response = await create(ownerId);

      expect(response.status).toBe(201);
    });
  });

  it("answers 422 for a reserved slug", async () => {
    const response = await createAsOwner({ name: "Admin", slug: "admin" });

    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: "slug_reserved" });
  });

  it("answers 422 with the error envelope for an invalid body", async () => {
    const response = await createAsOwner({ name: "", slug: "Bad Slug" });

    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: "validation_failed" });
  });

  it("answers 422 for a malformed JSON body", async () => {
    const response = await api.request("/api/v1/communities", {
      method: "POST",
      headers: { "content-type": "application/json", [sessionHeader]: ownerId },
      body: "{",
    });

    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: "validation_failed" });
  });
});

describe("GET /api/v1/communities/me", () => {
  it("lists the signed in person's communities", async () => {
    await createAsOwner({ name: "Makers", slug: "makers" });

    const response = await request("/communities/me", { userId: ownerId });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ community: { slug: "makers" }, membership: { role: "owner" } }],
      nextCursor: null,
    });
  });

  it("answers 401 without a session", async () => {
    expect((await request("/communities/me")).status).toBe(401);
  });
});

describe("GET /api/v1/communities/{slug}", () => {
  it("returns a public community to a guest", async () => {
    await createAsOwner({ name: "Makers", slug: "makers", privacy: "public" });

    const response = await request("/communities/makers");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: "full",
      slug: "makers",
      privacy: "public",
      memberCount: 1,
    });
  });

  it("returns only the About view of a private community to a guest", async () => {
    await createAsOwner({ name: "Hidden", slug: "hidden", description: "Members only" });

    const response = await request("/communities/hidden");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      access: "limited",
      slug: "hidden",
      name: "Hidden",
      description: "Members only",
      privacy: "private",
      coverUrl: null,
      memberCount: 1,
      joinMode: "approval",
      joinQuestions: [],
    });
    expect(body).not.toHaveProperty("createdAt");
  });

  it("includes the detailed description and gallery in the About view", async () => {
    const community = repo.addCommunity({
      slug: communitySlugSchema.parse("described"),
      name: "Described",
      detailedDescription: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Weekly calls" }] }],
      },
    });
    repo.addGalleryItem({
      communityId: community.id,
      kind: "video_embed",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });

    const response = await request("/communities/described");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: "limited",
      detailedDescription: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Weekly calls" }] }],
      },
      gallery: [
        {
          kind: "video_embed",
          provider: "youtube",
          url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
          altText: null,
          position: 0,
        },
      ],
    });
  });

  it("returns the full private community to its owner", async () => {
    await createAsOwner({ name: "Hidden", slug: "hidden" });

    const response = await request("/communities/hidden", { userId: ownerId });

    expect(await response.json()).toMatchObject({
      access: "full",
      joinMode: "approval",
      detailedDescription: null,
      gallery: [],
    });
  });

  it("answers 409 when a non member joins a private community that reviews requests", async () => {
    await createAsOwner({ name: "Hidden", slug: "hidden" });

    const response = await request("/communities/hidden/join", {
      method: "POST",
      userId: memberId,
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "approval_required" });
  });

  it("answers 404 for an unknown slug", async () => {
    expect((await request("/communities/nowhere")).status).toBe(404);
  });
});

describe("POST /api/v1/communities/{slug}/join and leave", () => {
  beforeEach(async () => {
    await createAsOwner({ name: "Makers", slug: "makers", privacy: "public" });
  });

  it("joins a public community and is idempotent", async () => {
    const first = await request("/communities/makers/join", { method: "POST", userId: memberId });
    const second = await request("/communities/makers/join", { method: "POST", userId: memberId });

    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string; status: string };
    expect(firstBody.status).toBe("active");
    expect(((await second.json()) as { id: string }).id).toBe(firstBody.id);
  });

  it("answers 409 with a plain message when the community is at its member limit", async () => {
    const limited = createApi(() =>
      apiDeps({
        resolveSession,
        communities: createCommunitiesService(repo, {
          fairUse: parseFairUseEnv({ FAIR_USE_MEMBERS: "1" }),
        }),
        posts: createPostsService({
          repo: createFakePostsRepository(),
          storage: {
            put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
            publicUrl: (key) => key,
          },
        }),
      }),
    );

    const response = await limited.request("/api/v1/communities/makers/join", {
      method: "POST",
      headers: { [sessionHeader]: memberId },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "limit_reached",
        message:
          "This community has reached its limit of 1 member, so it can't take new members right now.",
        details: { resource: "members", limit: 1, used: 1 },
      },
    });
  });

  it("answers 401 to join without a session", async () => {
    expect((await request("/communities/makers/join", { method: "POST" })).status).toBe(401);
  });

  it("answers 402 instead of a free membership when the community is paid", async () => {
    repo.addCommunity({ slug: "paid", privacy: "public", currency: "usd" });

    const response = await request("/communities/paid/join", { method: "POST", userId: memberId });

    expect(response.status).toBe(402);
    expect(await errorOf(response)).toMatchObject({ code: "payment_required" });
  });

  it("answers 403 to a banned person", async () => {
    const community = await repo.findCommunityBySlug(communitySlugSchema.parse("makers"));
    if (!community) throw new Error("community missing");
    repo.addMembership({ communityId: community.id, userId: memberId, status: "banned" });

    const response = await request("/communities/makers/join", {
      method: "POST",
      userId: memberId,
    });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
  });

  it("lets a member leave", async () => {
    await request("/communities/makers/join", { method: "POST", userId: memberId });

    const response = await request("/communities/makers/leave", {
      method: "POST",
      userId: memberId,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "removed" });
  });

  it("answers 409 when the owner tries to leave", async () => {
    const response = await request("/communities/makers/leave", {
      method: "POST",
      userId: ownerId,
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "owner_cannot_leave" });
  });

  it("answers 404 when a non member leaves", async () => {
    const response = await request("/communities/makers/leave", {
      method: "POST",
      userId: memberId,
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/communities/{slug}/membership", () => {
  beforeEach(async () => {
    await createAsOwner({ name: "Makers", slug: "makers", privacy: "public" });
  });

  it("returns the signed in person's membership", async () => {
    const response = await request("/communities/makers/membership", { userId: ownerId });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ membership: { role: "owner" } });
  });

  it("returns null for a non member", async () => {
    const response = await request("/communities/makers/membership", { userId: memberId });

    expect(await response.json()).toEqual({ membership: null });
  });

  it("answers 401 without a session", async () => {
    expect((await request("/communities/makers/membership")).status).toBe(401);
  });
});

describe("unknown routes", () => {
  it("answer 404 with the error envelope", async () => {
    const response = await request("/nothing-here");

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatchObject({ code: "not_found" });
  });
});

describe("a community URL that changed", () => {
  it("answers 308 to the new URL and keeps the rest of the path and the query", async () => {
    const community = repo.addCommunity({
      slug: communitySlugSchema.parse("new-name"),
      privacy: "public",
    });
    repo.addFormerSlug("old-name", community.id);

    const feed = await request("/communities/old-name/posts?sort=new&limit=5");
    const root = await request("/communities/old-name");

    expect(feed.status).toBe(308);
    expect(feed.headers.get("location")).toBe(
      "/api/v1/communities/new-name/posts?sort=new&limit=5",
    );
    expect(root.status).toBe(308);
    expect(root.headers.get("location")).toBe("/api/v1/communities/new-name");
  });

  it("still answers 404 for a URL no community ever used", async () => {
    const response = await request("/communities/never-used");

    expect(response.status).toBe(404);
  });
});
