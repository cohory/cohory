import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService } from "@cohory/agents";
import { createOAuthService, oauthIssuer, s256Challenge } from "@cohory/agents/oauth";
import { betterAuthSessionResolver, createApi, mcpBindingsFor } from "@cohory/api";
import { createAuth, createAuthOptions } from "@cohory/auth";
import type { Scope } from "@cohory/authz";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import {
  addMembership,
  createDb,
  createPool,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  setMembershipStatus,
  withCommunity,
} from "@cohory/db";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiDeps } from "@cohory/api/services";

import { mcpTools } from "./default";
import { createMcpHandler } from "./handler";

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
const oauth = createOAuthService({ db, issuer: oauthIssuer(baseURL) });
const limiter = createRateLimiter({ rules: rateLimitDefaults });
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
    rateLimiter: limiter,
  }),
);
const tools = mcpTools(api);
const handle = createMcpHandler({
  fetchApi: async (request, caller) => api.fetch(request, mcpBindingsFor(caller)),
  tools: () => tools,
  authenticate: (raw) => agents.authenticate(raw),
  rateLimiter: () => limiter,
  resourceMetadataUrl: () => `${baseURL}/.well-known/oauth-protected-resource/mcp`,
});

const verifier = "s3-mcp-verifier-".repeat(4);
const redirectUri = "http://127.0.0.1:47012/callback";
let cookie = "";
let ownerId = "";
let slug = "";
let communityId = "";
let clientId = "";

interface Connection {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly grantId: string;
  readonly agentId: string;
}

afterAll(async () => {
  await pool.end();
});

async function rest(path: string, init: { method?: string; body?: unknown } = {}) {
  return api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", cookie },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

let rpcId = 1;

function mcp(token: string, method: string, params: Record<string, unknown> = {}) {
  return handle(
    new Request(`${baseURL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    }),
  );
}

const actor = () => ({ kind: "user" as const, userId: ownerId, platformAdmin: false });

async function connect(scopes: Scope[], userId = ownerId): Promise<Connection> {
  const consent = await oauth.approve(
    { kind: "user", userId, platformAdmin: false },
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
      communityId,
      agent: { kind: "new", name: `Desk ${newId().slice(-6)}` },
      scopes,
    },
  );
  if (consent.kind !== "redirect") throw new Error(consent.message);
  const code = new URL(consent.url).searchParams.get("code") ?? "";
  const tokens = await oauth.token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: `${baseURL}/mcp`,
  });
  const authenticated = await agents.authenticate(tokens.access_token);
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    grantId: authenticated.oauthGrantId ?? "",
    agentId: authenticated.credential.agentId ?? "",
  };
}

beforeAll(async () => {
  const signUp = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `mcp-oauth-${newId()}@example.test`,
        password: "correct horse battery staple",
        name: "Mcp OAuth owner",
      }),
    }),
  );
  cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";
  ownerId = ((await signUp.json()) as { user: { id: string } }).user.id;
  slug = `mcp-oauth-${newId().slice(-12)}`;
  const created = await rest("/communities", {
    method: "POST",
    body: { name: "Mcp OAuth", slug },
  });
  communityId = ((await created.json()) as { community: { id: string } }).community.id;
  const registered = await oauth.register({
    client_name: "Desk Assistant",
    redirect_uris: [redirectUri],
  });
  clientId = registered.client_id;
});

describe("OAuth access tokens at /mcp", () => {
  it("call tools, and are refused by /api/v1 directly", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    expect((await mcp(connection.access_token, "tools/list")).status).toBe(200);
    const listed = await mcp(connection.access_token, "tools/call", {
      name: "list_posts",
      arguments: {},
    });
    expect(listed.status).toBe(200);
    const direct = await api.request(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: `Bearer ${connection.access_token}` },
    });
    expect(direct.status).toBe(401);
  });

  it("answer a missing scope with 403 and a step up challenge", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    const response = await mcp(connection.access_token, "tools/call", {
      name: "create_draft_post",
      arguments: { title: "No", body: { type: "doc", content: [] } },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('scope="posts:write"');
  });

  it("stop on the next call after Disconnect", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    expect((await mcp(connection.access_token, "tools/list")).status).toBe(200);
    await oauth.disconnect(actor(), connection.grantId);
    const after = await mcp(connection.access_token, "tools/list");
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain('error="invalid_token"');
    const answer = (await after.json()) as { error: { message: string } };
    expect(answer.error.message).toBe("This connection was ended. Connect the app again.");
  });

  it("stop on the next call after a rotated refresh token is reused", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    const rotated = await oauth.token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: connection.refresh_token,
    });
    expect((await mcp(rotated.access_token, "tools/list")).status).toBe(200);
    await expect(
      oauth.token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: connection.refresh_token,
      }),
    ).rejects.toThrow();
    expect((await mcp(rotated.access_token, "tools/list")).status).toBe(401);
  });

  it("stop on the next call after the client revokes the access token", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    await oauth.revoke({ token: connection.access_token, client_id: clientId });
    expect((await mcp(connection.access_token, "tools/list")).status).toBe(401);
  });

  it("stop on the next call after the agent is revoked in Settings", async () => {
    const connection = await connect(["community:read", "posts:read"]);
    const revoked = await rest(`/communities/${slug}/agents/${connection.agentId}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);
    expect((await mcp(connection.access_token, "tools/list")).status).toBe(401);
  });
});

describe("personal tokens at /mcp", () => {
  it("stop on the next call after the token is revoked in Account", async () => {
    const issued = await rest("/me/api-tokens", {
      method: "POST",
      body: { communityId, name: "Laptop", scopes: ["posts:read"] },
    });
    const body = (await issued.json()) as { token: string; tokenInfo: { id: string } };
    expect((await mcp(body.token, "tools/list")).status).toBe(200);
    expect((await rest(`/me/api-tokens/${body.tokenInfo.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await mcp(body.token, "tools/list")).status).toBe(401);
  });
});

describe("OAuth access tokens of an agent whose person's membership ended", () => {
  it("stay refused on /api/v1 and only see the purchase and approval tools at /mcp", async () => {
    const signUp = await signUpWithSession(
      auth.handler,
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseURL },
        body: JSON.stringify({
          email: `mcp-oauth-lapsed-${newId()}@example.test`,
          password: "correct horse battery staple",
          name: "Lapsing member",
        }),
      }),
    );
    const memberId = ((await signUp.json()) as { user: { id: string } }).user.id;
    const community = withCommunity(db, parseCommunityId(communityId));
    await addMembership(community, { userId: memberId, role: "admin", status: "active" });
    const connection = await connect(["courses:read", "proposals:write"], memberId);
    await setMembershipStatus(community, memberId, "removed");

    const direct = await api.request(`/api/v1/communities/${slug}/agent-courses`, {
      headers: { authorization: `Bearer ${connection.access_token}` },
    });
    expect(direct.status).toBe(401);
    expect(await direct.json()).toMatchObject({ error: { details: { reason: "wrong_resource" } } });

    const listed = (await (await mcp(connection.access_token, "tools/list")).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual([
      "get_approval_status",
      "list_my_approval_requests",
      "propose_course_purchase",
    ]);
    const refused = (await (
      await mcp(connection.access_token, "tools/call", { name: "list_my_courses", arguments: {} })
    ).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0]?.text).toContain("membership_required");
  });
});
