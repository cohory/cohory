import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService } from "@cohory/agents";
import { createApprovalsService } from "@cohory/agents/approvals";
import { betterAuthSessionResolver, createApi, mcpBindingsFor } from "@cohory/api";
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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
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
const approvals = createApprovalsService({ db });
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
    approvals,
    rateLimiter: createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        agentRequest: { max: 1000, windowSeconds: 60 },
        agentWrite: { max: 1000, windowSeconds: 3600 },
      },
    }),
  }),
);
const tools = mcpTools(api);
const handle = createMcpHandler({
  fetchApi: async (request, caller) => api.fetch(request, mcpBindingsFor(caller)),
  tools: () => tools,
  authenticate: (raw) => agents.authenticate(raw),
  rateLimiter: () => createRateLimiter({ rules: rateLimitDefaults }),
  resourceMetadataUrl: () => `${baseURL}/.well-known/oauth-protected-resource`,
});

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

let owner: Person;
let admin: Person;
let target: Person;
let slugA = "";
let slugB = "";
let communityA = "";
let postInB = "";
const clients: Client[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await pool.end();
});

async function signUp(): Promise<Person> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `mcp-${newId()}@example.test`,
        password: "correct horse battery staple",
        name: "Mcp person",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  const body = (await response.json()) as { user: { id: string } };
  if (!cookie) throw new Error("no session cookie");
  return { cookie, userId: body.user.id };
}

async function rest(
  path: string,
  init: { method?: string; cookie?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function agentToken(person: Person, scopes: string[]) {
  const created = await rest(`/communities/${slugA}/agents`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: `Agent ${newId().slice(-4)}`, scopes },
  });
  expect(created.status).toBe(201);
  const { id: agentId } = (await created.json()) as { id: string };
  const issued = await rest(`/communities/${slugA}/agents/${agentId}/tokens`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: "Mcp key" },
  });
  expect(issued.status).toBe(201);
  const body = (await issued.json()) as { token: string; tokenInfo: { id: string } };
  return { token: body.token, agentId, tokenId: body.tokenInfo.id };
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "cohory-integration", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (url, init) => handle(new Request(url, init)),
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

interface Outcome {
  readonly status: number | null;
  readonly code: string | null;
  readonly body: unknown;
}

async function restOutcome(response: Response): Promise<Outcome> {
  const body: unknown = response.status === 204 ? null : await response.json();
  const code =
    !response.ok && body && typeof body === "object" && "error" in body
      ? ((body.error as { code?: string }).code ?? null)
      : null;
  return { status: response.ok ? response.status : null, code, body: response.ok ? body : null };
}

async function mcpOutcome(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  if (result.isError) {
    const text = result.content[0]?.type === "text" ? result.content[0].text : "{}";
    const parsed = JSON.parse(text) as { error: { code: string } };
    return { status: null, code: parsed.error.code, body: null };
  }
  const structured = result.structuredContent as { status: number; result: unknown };
  return { status: structured.status, code: null, body: structured.result };
}

async function setRole(userId: string, role: "admin" | "member"): Promise<void> {
  await runInCommunity(withCommunity(db, parseCommunityId(communityA)), ({ tx, where }) =>
    tx
      .update(memberships)
      .set({ role })
      .where(where(memberships, and(eq(memberships.userId, userId)))),
  );
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
  target = await signUp();
  slugA = `mcp-a-${newId().slice(-12)}`;
  slugB = `mcp-b-${newId().slice(-12)}`;
  const created = await rest("/communities", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Mcp A", slug: slugA },
  });
  expect(created.status).toBe(201);
  communityA = ((await created.json()) as { community: { id: string } }).community.id;
  expect(
    (
      await rest("/communities", {
        method: "POST",
        cookie: owner.cookie,
        body: { name: "Mcp B", slug: slugB },
      })
    ).status,
  ).toBe(201);
  const scope = withCommunity(db, parseCommunityId(communityA));
  await addMembership(scope, { userId: admin.userId, role: "admin", status: "active" });
  await setRole(admin.userId, "admin");
  await addMembership(scope, { userId: target.userId, role: "member", status: "active" });
  const posted = await rest(`/communities/${slugA}/posts`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Glaze firing notes", body: doc("Cone 6 glaze firing schedule") },
  });
  expect(posted.status).toBe(201);
  const other = await rest(`/communities/${slugB}/posts`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Private to B", body: doc("Only for community B") },
  });
  expect(other.status).toBe(201);
  postInB = ((await other.json()) as { id: string }).id;
});

describe("MCP and REST give the same outcome", () => {
  it("for an allowed read", async () => {
    const { token } = await agentToken(owner, ["posts:read"]);
    const client = await connect(token);
    const viaRest = await restOutcome(
      await rest(`/communities/${slugA}/search?q=glaze`, { token }),
    );
    const viaMcp = await mcpOutcome(client, "search_community", { q: "glaze" });
    expect(viaRest.status).toBe(200);
    expect(viaMcp).toEqual(viaRest);
  });

  it("for a write the token's scopes do not allow", async () => {
    const { token } = await agentToken(owner, ["posts:read"]);
    const client = await connect(token);
    const viaRest = await restOutcome(
      await rest(`/communities/${slugA}/posts`, {
        method: "POST",
        token,
        body: { body: doc("Nope") },
      }),
    );
    const viaMcp = await mcpOutcome(client, "create_draft_post", { body: doc("Nope") });
    expect(viaRest.code).toBe("insufficient_scope");
    expect(viaMcp).toEqual(viaRest);
  });

  it("for a read the owner's role no longer allows, and the tool leaves the list", async () => {
    const { token } = await agentToken(admin, ["members:read"]);
    const client = await connect(token);
    const before = (await client.listTools()).tools.map((tool) => tool.name);
    expect(before).toContain("find_inactive_members");
    await setRole(admin.userId, "member");
    try {
      const viaRest = await restOutcome(
        await rest(`/communities/${slugA}/manage/people?inactiveDays=30`, { token }),
      );
      const viaMcp = await mcpOutcome(client, "find_inactive_members", { inactiveDays: 30 });
      expect(viaRest.status).toBeNull();
      expect(viaMcp).toEqual(viaRest);
      const after = (await client.listTools()).tools.map((tool) => tool.name);
      expect(after).not.toContain("find_inactive_members");
    } finally {
      await setRole(admin.userId, "admin");
    }
  });

  it("for a post that belongs to another community", async () => {
    const { token } = await agentToken(owner, ["posts:read"]);
    const client = await connect(token);
    const viaRest = await restOutcome(
      await rest(`/communities/${slugA}/posts/${postInB}`, { token }),
    );
    const viaMcp = await mcpOutcome(client, "get_post", { postId: postInB });
    expect(viaRest.code).toBe("not_found");
    expect(viaMcp).toEqual(viaRest);
  });

  it("for a removal without proposals:write", async () => {
    const { token } = await agentToken(owner, ["members:read", "members:moderate"]);
    const client = await connect(token);
    const path = `/communities/${slugA}/manage/people/${target.userId}/remove`;
    const viaRest = await restOutcome(await rest(path, { method: "POST", token }));
    const viaMcp = await mcpOutcome(client, "remove_member", { userId: target.userId });
    expect(viaRest.code).toBe("approval_required");
    expect(viaMcp).toEqual(viaRest);
  });

  it("for a removal that becomes an approval request, audited as mcp", async () => {
    const { token, tokenId } = await agentToken(owner, [
      "members:read",
      "members:moderate",
      "proposals:write",
    ]);
    const client = await connect(token);
    const path = `/communities/${slugA}/manage/people/${target.userId}/remove`;
    const viaRest = await restOutcome(await rest(path, { method: "POST", token }));
    const viaMcp = await mcpOutcome(client, "remove_member", { userId: target.userId });
    expect(viaRest.status).toBe(202);
    expect(viaMcp.status).toBe(202);
    expect(viaMcp.body).toMatchObject({ status: "pending_approval", summary: expect.any(String) });
    const pending = viaMcp.body as { approvalId: string; statusUrl: string };
    expect(pending.statusUrl).toBe(`/api/v1/communities/${slugA}/approvals/${pending.approvalId}`);

    const status = await mcpOutcome(client, "get_approval_status", {
      approvalId: pending.approvalId,
    });
    expect(status.body).toMatchObject({ id: pending.approvalId, state: "pending" });

    const requested = (await auditFor(tokenId)).filter(
      (row) => row.action === "approval.requested",
    );
    expect(requested.map((row) => row.via).sort()).toEqual(["api", "mcp"]);
  });
});

describe("MCP sessions", () => {
  it("audits writes with via mcp and creates agent drafts", async () => {
    const { token, tokenId, agentId } = await agentToken(owner, ["posts:read", "posts:write"]);
    const client = await connect(token);
    const created = await mcpOutcome(client, "create_draft_post", {
      title: "From an assistant",
      body: doc("Drafted over MCP"),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "draft", agent: { id: agentId } });
    const rows = await auditFor(tokenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "api.create_post",
      actorType: "agent",
      via: "mcp",
      agentId,
      actorId: owner.userId,
    });
  });

  it("refuses a revoked token on the next call", async () => {
    const { token, agentId } = await agentToken(owner, ["posts:read"]);
    const client = await connect(token);
    expect((await mcpOutcome(client, "list_posts", {})).status).toBe(200);
    const revoked = await rest(`/communities/${slugA}/agents/${agentId}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(revoked.status).toBe(204);
    await expect(client.callTool({ name: "list_posts", arguments: {} })).rejects.toThrow();
    const response = await handle(
      new Request(`${baseURL}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("wraps member written posts as untrusted content", async () => {
    const { token } = await agentToken(owner, ["posts:read"]);
    const client = await connect(token);
    const result = (await client.callTool({ name: "list_posts", arguments: {} })) as CallToolResult;
    expect(result.structuredContent).toMatchObject({
      untrusted_content: { source: "Cohory community members" },
    });
  });
});
