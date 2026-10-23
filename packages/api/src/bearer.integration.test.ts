import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService } from "@cohory/agents";
import { createAuth, createAuthOptions } from "@cohory/auth";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import {
  addMembership,
  createDb,
  createPool,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  runInCommunity,
  withCommunity,
} from "@cohory/db";
import { auditLog, memberships } from "@cohory/db/schema";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";
import { betterAuthSessionResolver } from "./middleware/session";

const baseURL = "http://localhost:3000";
const pool = createPool(parseDatabaseEnv().DATABASE_URL);
const db = createDb(pool);
const auth = createAuth(
  createAuthOptions(
    db,
    {
      BETTER_AUTH_SECRET: "integration-secret-that-is-at-least-32-chars",
      BETTER_AUTH_URL: baseURL,
    },
    { send: async () => undefined },
  ),
);
const agents = createAgentsService({ db });
const rateLimiter = createRateLimiter({
  rules: { ...rateLimitDefaults, apiToken: { max: 3, windowSeconds: 60 } },
});
const api = createApi(() =>
  apiDeps({
    resolveSession: betterAuthSessionResolver(auth),
    communities: createCommunitiesService(createPostgresCommunitiesRepository(db)),
    posts: createPostsService({
      repo: createPostgresPostsRepository(db),
      storage: {
        put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
        publicUrl: (key) => key,
      },
    }),
    agents,
    rateLimiter,
  }),
);

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

let owner: Person;
let admin: Person;
let slugA = "";
let slugB = "";
let communityA = "";

afterAll(async () => {
  await pool.end();
});

async function signUp(): Promise<Person> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `bearer-${newId()}@example.test`,
        password: "correct horse battery staple",
        name: "Bearer person",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  const body = (await response.json()) as { user: { id: string } };
  if (!cookie) throw new Error("no session cookie");
  return { cookie, userId: body.user.id };
}

function call(
  path: string,
  init: { method?: string; cookie?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return Promise.resolve(
    api.request(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function createAgentToken(
  person: Person,
  slug: string,
  scopes: string[],
): Promise<{ token: string; agentId: string; tokenId: string }> {
  const agent = await call(`/communities/${slug}/agents`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: `Agent ${newId().slice(-4)}`, scopes },
  });
  expect(agent.status).toBe(201);
  const { id: agentId } = (await agent.json()) as { id: string };
  const issued = await call(`/communities/${slug}/agents/${agentId}/tokens`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: "Test key" },
  });
  expect(issued.status).toBe(201);
  expect(issued.headers.get("cache-control")).toBe("no-store");
  const body = (await issued.json()) as { token: string; tokenInfo: { id: string } };
  return { token: body.token, agentId, tokenId: body.tokenInfo.id };
}

async function auditFor(tokenId: string) {
  return runInCommunity(withCommunity(db, parseCommunityId(communityA)), ({ tx, where }) =>
    tx
      .select()
      .from(auditLog)
      .where(where(auditLog, eq(auditLog.tokenId, tokenId))),
  );
}

beforeAll(async () => {
  owner = await signUp();
  admin = await signUp();
  slugA = `bearer-a-${newId().slice(-12)}`;
  slugB = `bearer-b-${newId().slice(-12)}`;
  const created = await call("/communities", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Bearer A", slug: slugA },
  });
  expect(created.status).toBe(201);
  communityA = ((await created.json()) as { community: { id: string } }).community.id;
  expect(
    (
      await call("/communities", {
        method: "POST",
        cookie: owner.cookie,
        body: { name: "Bearer B", slug: slugB },
      })
    ).status,
  ).toBe(201);
  await addMembership(withCommunity(db, parseCommunityId(communityA)), {
    userId: admin.userId,
    role: "admin",
    status: "active",
  });
  await setRole(admin.userId, "admin");
});

async function setRole(userId: string, role: "admin" | "member"): Promise<void> {
  await runInCommunity(withCommunity(db, parseCommunityId(communityA)), ({ tx, where }) =>
    tx
      .update(memberships)
      .set({ role })
      .where(where(memberships, and(eq(memberships.userId, userId)))),
  );
}

describe("bearer tokens on /api/v1", () => {
  it("lets an agent create a draft post, marked as agent work and audited", async () => {
    const { token, agentId, tokenId } = await createAgentToken(owner, slugA, [
      "posts:read",
      "posts:write",
    ]);

    const created = await call(`/communities/${slugA}/posts`, {
      method: "POST",
      token,
      body: { title: "Agent draft", body: doc("Prepared by an agent") },
    });

    expect(created.status).toBe(201);
    expect(created.headers.get("ratelimit-limit")).toBe("30");
    const post = (await created.json()) as {
      id: string;
      status: string;
      agent: { id: string } | null;
    };
    expect(post.status).toBe("draft");
    expect(post.agent?.id).toBe(agentId);
    const feed = (await (await call(`/communities/${slugA}/posts`, { token })).json()) as {
      data: { id: string }[];
    };
    expect(feed.data.map((item) => item.id)).not.toContain(post.id);
    const drafts = (await (
      await call(`/communities/${slugA}/post-drafts`, { cookie: owner.cookie })
    ).json()) as { data: { id: string }[] };
    expect(drafts.data.map((item) => item.id)).toContain(post.id);

    const rows = await auditFor(tokenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "api.create_post",
      actorId: owner.userId,
      actorType: "agent",
      via: "api",
      agentId,
      tokenId,
    });

    const published = await call(`/communities/${slugA}/post-drafts/${post.id}/publish`, {
      method: "POST",
      cookie: owner.cookie,
    });
    expect(published.status).toBe(201);
    const live = (await published.json()) as { status: string; agent: { id: string } | null };
    expect(live).toMatchObject({ status: "published", agent: { id: agentId } });
  });

  it("refuses a revoked agent token on its next request", async () => {
    const { token, agentId } = await createAgentToken(owner, slugA, ["posts:read"]);
    expect((await call(`/communities/${slugA}/posts`, { token })).status).toBe(200);

    const revoked = await call(`/communities/${slugA}/agents/${agentId}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(revoked.status).toBe(204);

    const refused = await call(`/communities/${slugA}/posts`, { token });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("invalid_token");
    expect(await refused.json()).toMatchObject({
      error: { code: "invalid_token", details: { reason: "revoked" } },
    });
  });

  it("takes the owner's current role into account on every request", async () => {
    const { token } = await createAgentToken(admin, slugA, ["posts:read", "posts:write"]);
    const created = await call(`/communities/${slugA}/posts`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: doc("Pin me") },
    });
    const { id } = (await created.json()) as { id: string };

    expect(
      (await call(`/communities/${slugA}/posts/${id}/pin`, { method: "POST", token })).status,
    ).toBe(200);

    await setRole(admin.userId, "member");
    try {
      const denied = await call(`/communities/${slugA}/posts/${id}/pin`, {
        method: "DELETE",
        token,
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
    } finally {
      await setRole(admin.userId, "admin");
    }
  });

  it("refuses a scope the token does not hold and session only routes", async () => {
    const { token } = await createAgentToken(owner, slugA, ["posts:read"]);

    const write = await call(`/communities/${slugA}/posts`, {
      method: "POST",
      token,
      body: { body: doc("no") },
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({
      error: { code: "insufficient_scope", details: { required: "posts:write" } },
    });

    const mint = await call("/me/api-tokens", {
      method: "POST",
      token,
      body: { communityId: communityA, name: "child", scopes: ["posts:read"] },
    });
    expect(mint.status).toBe(403);
    expect(await mint.json()).toMatchObject({ error: { code: "token_not_allowed" } });
  });

  it("asks for approval when an agent tries to delete or remove", async () => {
    const { token } = await createAgentToken(owner, slugA, ["posts:write", "members:moderate"]);
    const created = await call(`/communities/${slugA}/posts`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: doc("Keep me") },
    });
    const { id } = (await created.json()) as { id: string };

    const deleted = await call(`/communities/${slugA}/posts/${id}`, { method: "DELETE", token });
    expect(deleted.status).toBe(403);
    expect(await deleted.json()).toMatchObject({
      error: { code: "approval_required", details: { category: "deletion" } },
    });
    const removed = await call(`/communities/${slugA}/manage/people/${admin.userId}/remove`, {
      method: "POST",
      token,
    });
    expect(removed.status).toBe(403);
    expect(await removed.json()).toMatchObject({
      error: { code: "approval_required", details: { category: "removal" } },
    });
  });

  it("refuses a token used against another community", async () => {
    const { token } = await createAgentToken(owner, slugA, ["posts:read", "community:read"]);

    const other = await call(`/communities/${slugB}/posts`, { token });

    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "wrong_community" } });
  });

  it("lets a person use a personal token, with rate limit headers and Retry-After", async () => {
    const created = await call("/me/api-tokens", {
      method: "POST",
      cookie: admin.cookie,
      body: { communityId: communityA, name: "Script", scopes: ["posts:read"] },
    });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };

    const first = await call(`/communities/${slugA}/posts`, { token });
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("3");
    expect(first.headers.get("ratelimit-remaining")).toBe("2");
    expect(Number(first.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
    await call(`/communities/${slugA}/posts`, { token });
    await call(`/communities/${slugA}/posts`, { token });

    const limited = await call(`/communities/${slugA}/posts`, { token });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("ratelimit-remaining")).toBe("0");

    const listed = (await (await call("/me/api-tokens", { cookie: admin.cookie })).json()) as {
      data: { name: string; prefix: string }[];
    };
    expect(listed.data.find((item) => item.name === "Script")?.prefix).toBe(token.slice(0, 12));
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("answers 401 with a plain message for an unknown or malformed token", async () => {
    const unknown = await call(`/communities/${slugA}/posts`, {
      token: `cohory_${"x".repeat(43)}`,
    });
    expect(unknown.status).toBe(401);
    const malformed = await api.request(`/api/v1/communities/${slugA}/posts`, {
      headers: { authorization: "Basic abc" },
    });
    expect(malformed.status).toBe(401);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_token" } });
  });

  it("keeps session cookies working unchanged", async () => {
    const response = await call(`/communities/${slugA}/posts`, { cookie: owner.cookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-limit")).toBeNull();
  });
});
