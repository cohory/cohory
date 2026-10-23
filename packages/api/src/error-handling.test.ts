import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";
import type { SessionResolver } from "./middleware/session";
import { createPaymentsStub, type PaymentsStub } from "./test/payments-stub";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const userId = newId();
const communityId = newId();

let repo: ReturnType<typeof createFakeRepository>;
let payments: PaymentsStub;
let api: ReturnType<typeof createApi>;
let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  repo = createFakeRepository();
  payments = createPaymentsStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (key) => key,
        },
      }),
      payments,
    }),
  );
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

function call(path: string, init: { method?: string; body?: string } = {}): Promise<Response> {
  const headers = new Headers({ [sessionHeader]: userId });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.request(`/api/v1${path}`, { method: init.method ?? "GET", headers, body: init.body }),
  );
}

describe("a community URL that changed", () => {
  beforeEach(() => {
    const community = repo.addCommunity({
      slug: communitySlugSchema.parse("new-name"),
      privacy: "public",
    });
    repo.addFormerSlug("old-name", community.id);
  });

  it("answers 308 on a manage route", async () => {
    const response = await call("/communities/old-name/manage/overview?range=30d");

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "/api/v1/communities/new-name/manage/overview?range=30d",
    );
  });

  it("answers 308 on a calendar route", async () => {
    const response = await call("/communities/old-name/calendar/upcoming");

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/api/v1/communities/new-name/calendar/upcoming");
  });
});

describe("an unexpected error", () => {
  const unhandled = (): string[] =>
    logged.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes("unhandled api error"));

  it("is logged once and answers 500 on subscription linking", async () => {
    payments.listSubscriptionLinks.mockRejectedValue(new Error("boom"));

    const response = await call(`/communities/${communityId}/payments/subscribers/links`);

    expect(response.status).toBe(500);
    expect(unhandled()).toHaveLength(1);
  });

  it("is logged once and answers 500 on comps", async () => {
    payments.listComps.mockRejectedValue(new Error("boom"));

    const response = await call(`/communities/${communityId}/payments/comps`);

    expect(response.status).toBe(500);
    expect(unhandled()).toHaveLength(1);
  });
});

describe("a body over the limit", () => {
  it("answers 413 with the error envelope on community create", async () => {
    const response = await call("/communities", {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(70 * 1024), slug: "makers" }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
  });

  it("answers 413 on every operation that takes a body", async () => {
    const document = (await (await api.request("/api/openapi.json")).json()) as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
    };
    const unlimited: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!operation.requestBody) continue;
        const response = await api.request(path.replace(/\{[^}]+\}/g, "x"), {
          method: method.toUpperCase(),
          headers: {
            [sessionHeader]: userId,
            "content-type": "application/json",
            "content-length": String(2 ** 30),
          },
          body: "{}",
        });
        if (response.status !== 413) unlimited.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(unlimited).toEqual([]);
  });
});
