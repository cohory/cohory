import type { Actor } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import type { GamificationService, Leaderboard } from "@cohory/gamification";
import { createMembersService } from "@cohory/members";
import { createFakeMembersRepository } from "@cohory/members/testing";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

let communitiesRepo: ReturnType<typeof createFakeRepository>;
let membersRepo: ReturnType<typeof createFakeMembersRepository>;
let leaderboard: Leaderboard;
let getLeaderboard: ReturnType<typeof vi.fn<GamificationService["getLeaderboard"]>>;
let api: ReturnType<typeof createApi>;
let communityId: string;

function addMember(name = "Person", role: "member" | "owner" = "member"): string {
  const userId = membersRepo.addMember(communityId, { name, role, points: 3, level: 1 });
  communitiesRepo.addMembership({ communityId, userId, role, status: "active" });
  return userId;
}

beforeEach(() => {
  communitiesRepo = createFakeRepository();
  membersRepo = createFakeMembersRepository();
  communityId = membersRepo.addCommunity({ levelNames: ["Newcomer"] });
  communitiesRepo.addCommunity({
    id: communityId as never,
    slug: communitySlugSchema.parse("makers"),
  });
  leaderboard = { status: "disabled" };
  getLeaderboard = vi.fn<GamificationService["getLeaderboard"]>(async () => leaderboard);
  const gamification: GamificationService = {
    getLeaderboard,
    recordPostEvents: async () => ({ inserted: 0 }),
    recomputeMemberStats: async () => ({ members: 0 }),
    learningPointsCommunities: async () => [],
    recordLearningActivities: async () => ({ inserted: 0 }),
    resetPoints: async () => ({ members: 0, points: 0 }),
    resetMemberPoints: async () => ({ members: 0, points: 0 }),
  };
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(communitiesRepo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      members: createMembersService(membersRepo),
      gamification,
    }),
  );
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("GET /communities/{slug}/members", () => {
  it("lists members for a member with level names and ISO dates", async () => {
    const viewer = addMember("Viewer");
    addMember("Ada");

    const response = await call("/communities/makers/members?query=ad&limit=5", {
      userId: viewer,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown>[]; nextCursor: null };
    expect(body.data).toEqual([
      expect.objectContaining({
        name: "Ada",
        bio: null,
        points: 3,
        level: 1,
        levelName: "Newcomer",
      }),
    ]);
    expect(typeof body.data[0]?.joinedAt).toBe("string");
  });

  it("answers 404 to a stranger and 422 to a bad level", async () => {
    const viewer = addMember();

    expect((await call("/communities/makers/members", { userId: newId() })).status).toBe(404);
    const bad = await call("/communities/makers/members?level=12", { userId: viewer });
    expect(bad.status).toBe(422);
    expect(await errorCode(bad)).toBe("validation_failed");
  });
});

describe("GET /communities/{slug}/members/{userId}", () => {
  it("returns the profile and 404 for an unknown member", async () => {
    const viewer = addMember();
    const ada = addMember("Ada");

    const found = await call(`/communities/makers/members/${ada}`, { userId: viewer });
    const missing = await call(`/communities/makers/members/${newId()}`, { userId: viewer });

    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      name: "Ada",
      bio: null,
      recentActivity: { posts: [], comments: [] },
    });
    expect(missing.status).toBe(404);
  });
});

describe("PATCH /communities/{slug}/members/me", () => {
  it("updates the caller's bio", async () => {
    const me = addMember("Me");

    const response = await call("/communities/makers/members/me", {
      method: "PATCH",
      userId: me,
      body: { bio: "Hello there" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId: me, bio: "Hello there" });
  });

  it("requires a session", async () => {
    const response = await call("/communities/makers/members/me", {
      method: "PATCH",
      body: { bio: "x" },
    });

    expect(response.status).toBe(401);
  });
});

describe("GET /communities/{slug}/leaderboard", () => {
  it("passes the window and serializes the board", async () => {
    const viewer = addMember();
    leaderboard = {
      status: "enabled",
      window: "7d",
      since: new Date("2026-10-11T12:00:00.000Z"),
      entries: [
        {
          rank: 1,
          userId: viewer,
          name: "Viewer",
          image: null,
          username: null,
          points: 4,
          level: 1,
          levelName: "Newcomer",
        },
      ],
      viewer: { rank: 1, points: 4, totalPoints: 4, level: 1, levelName: "Newcomer" },
      ladder: [],
      earning: { lessons: false, events: false },
    };

    const response = await call("/communities/makers/leaderboard?window=7d", { userId: viewer });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "enabled",
      window: "7d",
      since: "2026-10-11T12:00:00.000Z",
    });
    const [actor, id, input] = getLeaderboard.mock.calls[0] ?? [];
    expect((actor as Actor | undefined)?.kind).toBe("user");
    expect(id).toBe(communityId);
    expect(input).toEqual({ window: "7d" });
  });

  it("returns the disabled state and rejects an unknown window", async () => {
    const viewer = addMember();

    expect(
      await (await call("/communities/makers/leaderboard", { userId: viewer })).json(),
    ).toEqual({ status: "disabled" });
    expect(
      (await call("/communities/makers/leaderboard?window=30d", { userId: viewer })).status,
    ).toBe(422);
  });
});

describe("PATCH /me", () => {
  it("sets a username and maps conflicts and reserved names", async () => {
    const first = membersRepo.addUser();
    const second = membersRepo.addUser();

    const ok = await call("/me", { method: "PATCH", userId: first, body: { username: "Ada" } });
    const taken = await call("/me", { method: "PATCH", userId: second, body: { username: "ada" } });
    const reserved = await call("/me", {
      method: "PATCH",
      userId: second,
      body: { username: "admin" },
    });
    const invalid = await call("/me", { method: "PATCH", userId: second, body: { username: "a" } });
    const anonymous = await call("/me", { method: "PATCH", body: { username: "grace" } });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ username: "ada" });
    expect(taken.status).toBe(409);
    expect(await errorCode(taken)).toBe("username_taken");
    expect(reserved.status).toBe(422);
    expect(await errorCode(reserved)).toBe("username_reserved");
    expect(invalid.status).toBe(422);
    expect(anonymous.status).toBe(401);
  });
});

describe("OpenAPI", () => {
  it("documents the member and leaderboard routes", async () => {
    const doc = (await (await api.request("/api/openapi.json")).json()) as { paths: object };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/communities/{slug}/members",
        "/api/v1/communities/{slug}/members/{userId}",
        "/api/v1/communities/{slug}/members/me",
        "/api/v1/communities/{slug}/leaderboard",
        "/api/v1/me",
      ]),
    );
  });

  it("declares the bio on every member summary", async () => {
    const doc = (await (await api.request("/api/openapi.json")).json()) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    expect(Object.keys(doc.components.schemas.MemberSummary?.properties ?? {})).toContain("bio");
  });
});
