import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService, InvalidTokenError } from "@cohory/agents";
import { createOAuthService, oauthIssuer, s256Challenge } from "@cohory/agents/oauth";
import { createAuth, createAuthOptions } from "@cohory/auth";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import { createDb, createPool, newId, parseDatabaseEnv } from "@cohory/db";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";
import { mcpBindingsFor } from "./middleware/bearer";
import { betterAuthSessionResolver } from "./middleware/session";
import { createOAuthApp } from "./oauth";

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
const issuer = oauthIssuer(baseURL);
const oauth = createOAuthService({ db, issuer });
const rateLimiter = createRateLimiter({ rules: rateLimitDefaults });
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
const oauthHttp = createOAuthApp(() => ({ oauth, rateLimiter }));

const verifier = "s2-verifier-".repeat(5);
const redirectUri = "http://127.0.0.1:47011/callback";
let cookie = "";
let ownerId = "";
let slugA = "";
let slugB = "";
let communityA = "";
let clientId = "";

afterAll(async () => {
  await pool.end();
});

function call(
  path: string,
  init: { token?: string; cookie?: string; method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function viaMcp(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  let authenticated;
  try {
    authenticated = await agents.authenticate(token);
  } catch (error: unknown) {
    if (error instanceof InvalidTokenError) {
      return Response.json({ error: { details: { reason: error.reason } } }, { status: 401 });
    }
    throw error;
  }
  const request = new Request(`${baseURL}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return api.fetch(request, mcpBindingsFor({ raw: token, authenticated }));
}

function postForm(path: string, fields: Record<string, string>) {
  return oauthHttp.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

interface Tokens {
  access_token: string;
  refresh_token: string;
}

async function connect(): Promise<Tokens & { grantId: string }> {
  const consent = await oauth.approve(
    { kind: "user", userId: ownerId, platformAdmin: false },
    {
      request: {
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state: "s",
        code_challenge: s256Challenge(verifier),
        code_challenge_method: "S256",
        resource: `${baseURL}/mcp`,
      },
      communityId: communityA,
      agent: { kind: "new", name: `Assistant ${newId().slice(-4)}` },
      scopes: ["community:read", "posts:read"],
    },
  );
  if (consent.kind !== "redirect") throw new Error(consent.message);
  const code = new URL(consent.url).searchParams.get("code") ?? "";
  const response = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: `${baseURL}/mcp`,
  });
  expect(response.status).toBe(200);
  const tokens = (await response.json()) as Tokens;
  const apps = await oauth.listMyConnectedApps({
    kind: "user",
    userId: ownerId,
    platformAdmin: false,
  });
  return { ...tokens, grantId: apps[0]?.grantId ?? "" };
}

beforeAll(async () => {
  const signUp = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `oauth-${newId()}@example.test`,
        password: "correct horse battery staple",
        name: "OAuth owner",
      }),
    }),
  );
  cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";
  ownerId = ((await signUp.json()) as { user: { id: string } }).user.id;
  slugA = `oauth-a-${newId().slice(-12)}`;
  slugB = `oauth-b-${newId().slice(-12)}`;
  const created = await call("/communities", {
    method: "POST",
    cookie,
    body: { name: "OAuth A", slug: slugA },
  });
  communityA = ((await created.json()) as { community: { id: string } }).community.id;
  await call("/communities", { method: "POST", cookie, body: { name: "OAuth B", slug: slugB } });
  const registered = await oauthHttp.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Integration client", redirect_uris: [redirectUri] }),
  });
  expect(registered.status).toBe(201);
  clientId = ((await registered.json()) as { client_id: string }).client_id;
});

describe("OAuth access tokens through MCP", () => {
  it("authorize the granted community and refuse another one", async () => {
    const tokens = await connect();
    const own = await viaMcp(`/communities/${slugA}/posts`, tokens.access_token);
    expect(own.status).toBe(200);
    expect(own.headers.get("ratelimit-limit")).toBe("30");
    const other = await viaMcp(`/communities/${slugB}/posts`, tokens.access_token);
    expect(other.status).toBe(403);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      "wrong_community",
    );
  });

  it("carry only the granted scopes", async () => {
    const tokens = await connect();
    const write = await viaMcp(`/communities/${slugA}/posts`, tokens.access_token, {
      method: "POST",
      body: { title: "No", body: { type: "doc", content: [] } },
    });
    expect(write.status).toBe(403);
    expect(((await write.json()) as { error: { code: string } }).error.code).toBe(
      "insufficient_scope",
    );
  });

  it("stop working after refresh token reuse revokes the family", async () => {
    const first = await connect();
    const refreshed = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: first.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as Tokens;
    expect((await viaMcp(`/communities/${slugA}/posts`, second.access_token)).status).toBe(200);

    const reuse = await postForm("/oauth/token", {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: first.refresh_token,
    });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
    const after = await viaMcp(`/communities/${slugA}/posts`, second.access_token);
    expect(after.status).toBe(401);
  });

  it("stop working on the next request after a disconnect", async () => {
    const tokens = await connect();
    expect((await viaMcp(`/communities/${slugA}/posts`, tokens.access_token)).status).toBe(200);
    await oauth.disconnect({ kind: "user", userId: ownerId, platformAdmin: false }, tokens.grantId);
    const after = await viaMcp(`/communities/${slugA}/posts`, tokens.access_token);
    expect(after.status).toBe(401);
    expect(
      ((await after.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe("revoked");
  });

  it("stop working after the client revokes the access token", async () => {
    const tokens = await connect();
    const revoked = await postForm("/oauth/revoke", {
      token: tokens.access_token,
      client_id: clientId,
    });
    expect(revoked.status).toBe(200);
    expect((await viaMcp(`/communities/${slugA}/posts`, tokens.access_token)).status).toBe(401);
  });
});

describe("OAuth access tokens outside MCP", () => {
  it("are refused on /api/v1 because they were issued for the /mcp resource", async () => {
    const tokens = await connect();
    const direct = await call(`/communities/${slugA}/posts`, { token: tokens.access_token });
    expect(direct.status).toBe(401);
    expect(direct.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(
      ((await direct.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe("wrong_resource");
    expect((await viaMcp(`/communities/${slugA}/posts`, tokens.access_token)).status).toBe(200);
  });
});
