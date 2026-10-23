import { ForbiddenError } from "@cohory/authz";
import { createCommunitiesService, JoinRequestNotFoundError } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { apiDeps } from "../services";

import { SearchValidationError, type SearchService } from "@cohory/search";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";
import { createManageStub, type ManageStub } from "../test/manage-stub";

const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get("x-test-user");
  return userId ? { userId } : null;
};

let manage: ManageStub;
let search: { search: ReturnType<typeof vi.fn<SearchService["search"]>> };
let api: ReturnType<typeof createApi>;
let communityId: string;
const staff = newId();
const requestId = newId();

beforeEach(() => {
  const repo = createFakeRepository();
  const community = repo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "public",
  });
  communityId = community.id;
  repo.addMembership({ communityId, userId: staff, role: "moderator" });
  manage = createManageStub();
  search = { search: vi.fn<SearchService["search"]>() };
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      publicUrl: (key) => `/files/${key}`,
    },
  });
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts,
      manage,
      search,
    }),
  );
});

function call(path: string, init: { method?: string; body?: unknown; userId?: string } = {}) {
  const headers = new Headers();
  if (init.userId !== undefined) headers.set("x-test-user", init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("join request routes", () => {
  it("lists pending requests with ISO dates", async () => {
    manage.listJoinRequests.mockResolvedValue({
      data: [
        {
          id: requestId,
          userId: newId(),
          name: "Ivy",
          username: null,
          image: null,
          email: null,
          answers: [{ question: "Why?", answer: "Clay" }],
          createdAt: new Date("2026-10-18T10:00:00.000Z"),
        },
      ],
      pendingCount: 1,
    });

    const response = await call("/manage/requests", { userId: staff });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      pendingCount: 1,
      data: [{ id: requestId, createdAt: "2026-10-18T10:00:00.000Z" }],
    });
  });

  it("approves with a note and declines without a body", async () => {
    manage.approveJoinRequest.mockResolvedValue({ requestId, userId: newId(), status: "approved" });
    manage.declineJoinRequest.mockResolvedValue({ requestId, userId: newId(), status: "declined" });

    const approve = await call(`/manage/requests/${requestId}/approve`, {
      method: "POST",
      userId: staff,
      body: { note: "Welcome" },
    });
    const decline = await call(`/manage/requests/${requestId}/decline`, {
      method: "POST",
      userId: staff,
    });

    expect(approve.status).toBe(200);
    expect(manage.approveJoinRequest).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      requestId,
      {
        note: "Welcome",
      },
    );
    expect(decline.status).toBe(200);
    expect(manage.declineJoinRequest).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      requestId,
      {},
    );
  });

  it("maps refusals and answered requests to 403 and 404", async () => {
    manage.listJoinRequests.mockRejectedValue(new ForbiddenError("approve", "membership"));
    manage.approveJoinRequest.mockRejectedValue(new JoinRequestNotFoundError());

    expect((await call("/manage/requests", { userId: staff })).status).toBe(403);
    expect(
      (await call(`/manage/requests/${requestId}/approve`, { method: "POST", userId: staff }))
        .status,
    ).toBe(404);
    expect(
      (await call("/manage/requests/not-a-uuid/approve", { method: "POST", userId: staff })).status,
    ).toBe(422);
  });
});

describe("search route", () => {
  it("searches by slug with the member as the rate key and serializes dates", async () => {
    search.search.mockResolvedValue({
      query: "clay",
      posts: [
        {
          postId: newId(),
          commentId: null,
          title: "Clay",
          excerpt: [{ text: "clay", match: true }],
          authorName: "Ivy",
          createdAt: new Date("2026-10-18T10:00:00.000Z"),
          rank: 1,
        },
      ],
      members: [],
      lessons: [],
    });

    const response = await call("/search?q=clay", { userId: staff });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { posts: { createdAt: string; rank?: number }[] };
    expect(body.posts[0]?.createdAt).toBe("2026-10-18T10:00:00.000Z");
    expect(body.posts[0]?.rank).toBeUndefined();
    expect(search.search).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      { query: "clay" },
      `user:${staff}`,
      expect.any(Function),
    );
  });

  it("answers 422 for a query without words", async () => {
    search.search.mockRejectedValue(new SearchValidationError());
    expect((await call("/search?q=%21%21", { userId: staff })).status).toBe(422);
    expect((await call("/search")).status).toBe(422);
  });
});
