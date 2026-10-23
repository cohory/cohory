import { signUpWithSession } from "@cohory/auth/testing";
import { createHash } from "node:crypto";
import { apiDeps } from "./services";

import { createAgentsService } from "@cohory/agents";
import { createApprovalsService } from "@cohory/agents/approvals";
import { createAuth, createAuthOptions } from "@cohory/auth";
import {
  agentForbiddenActions,
  approvalActions,
  availableScopes,
  nonGrantableActions,
  type Actor,
  type PolicyAction,
} from "@cohory/authz";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import {
  addMembership,
  auditSourceColumns,
  createDb,
  createPool,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  runInCommunity,
  withCommunity,
} from "@cohory/db";
import { apiTokens, approvalRequests, auditLog, memberships } from "@cohory/db/schema";
import { createApprovalNotifier } from "@cohory/notifications";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults, type RateLimiter } from "@cohory/rate-limit";
import { createWebhooksService } from "@cohory/webhooks";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApi, type ApiDeps } from "./app";
import { betterAuthSessionResolver } from "./middleware/session";
import { routeScopes, type OperationId } from "./route-meta";
import { createPaymentsStub } from "./test/payments-stub";

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
const approvals = createApprovalsService({ db, notify: createApprovalNotifier({ db }) });
const sessions = betterAuthSessionResolver(auth);
const generous = () =>
  createRateLimiter({
    rules: {
      ...rateLimitDefaults,
      apiToken: { max: 10_000, windowSeconds: 60 },
      agentRequest: { max: 10_000, windowSeconds: 60 },
      agentWrite: { max: 10_000, windowSeconds: 3600 },
    },
  });

function realDeps(rateLimiter: RateLimiter): ApiDeps {
  return apiDeps({
    resolveSession: sessions,
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
    payments: createPaymentsStub(),
    webhooks: createWebhooksService({
      db,
      key: () => Buffer.alloc(32, 7),
      queue: { enqueue: async () => undefined },
    }),
    rateLimiter,
  });
}

const sharedLimiter = generous();
const api = createApi(() => realDeps(sharedLimiter));

interface Recorded {
  readonly name: string;
  readonly via: string | null;
}

const recorded: Recorded[] = [];

function recorder<T extends object>(name: string): T {
  const target = {} as T;
  return new Proxy(target, {
    get(_target, property) {
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      return () => {
        recorded.push({ name: `${name}.${property}`, via: auditSourceColumns(null).via });
        throw new Error(`service ${name}.${property} must not run here`);
      };
    },
  });
}

const probeDeps: ApiDeps = apiDeps({
  resolveSession: sessions,
  agents,
  approvals,
  rateLimiter: generous(),
  communities: recorder("communities"),
  posts: recorder("posts"),
  manage: recorder("manage"),
  payments: recorder("payments"),
  migration: recorder("migration"),
  webhooks: recorder("webhooks"),
  search: recorder("search"),
  preferences: recorder("preferences"),
  platformBilling: recorder("platformBilling"),
  notifications: recorder("notifications"),
  members: recorder("members"),
  gamification: recorder("gamification"),
  courses: recorder("courses"),
  calendar: recorder("calendar"),
});
const probe = createApi(() => probeDeps);

interface Operation {
  readonly id: OperationId;
  readonly method: string;
  readonly path: string;
  readonly scope: string | null;
  readonly action: PolicyAction | null;
}

const document = (await (await api.request("/api/openapi.json")).json()) as {
  paths: Record<string, Record<string, { operationId: OperationId }>>;
  components: { schemas: Record<string, { description?: string; properties?: object }> };
};

const operations: Operation[] = Object.entries(document.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => ({
    id: operation.operationId,
    method: method.toUpperCase(),
    path,
    ...routeScopes[operation.operationId],
  })),
);

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

interface Key {
  readonly token: string;
  readonly agentId: string;
  readonly tokenId: string;
}

interface Tenant {
  readonly slug: string;
  readonly id: string;
  readonly owner: Person;
}

let tenantA: Tenant;
let tenantB: Tenant;
let adminA: Person;

afterAll(async () => {
  await pool.end();
});

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

async function signUp(name: string): Promise<Person> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `safety-${newId()}@example.test`,
        password: "correct horse battery staple",
        name,
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
  init: {
    method?: string;
    cookie?: string;
    token?: string;
    body?: unknown;
    app?: { request: typeof api.request };
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const target = init.app ?? api;
  return Promise.resolve(
    target.request(path.startsWith("/api/") ? path : `/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function pathFor(operation: Operation, tenant: Tenant, ids: Record<string, string> = {}): string {
  return operation.path.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    if (ids[name]) return ids[name];
    if (name === "slug") return tenant.slug;
    if (name === "communityId") return tenant.id;
    if (name.endsWith("Slug")) return "some-slug";
    if (name === "token") return "some-invite";
    return newId();
  });
}

function operation(id: OperationId): Operation {
  const found = operations.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no operation ${id}`);
  return found;
}

async function createTenant(name: string): Promise<Tenant> {
  const owner = await signUp(`${name} Owner`);
  const slug = `safety-${name.toLowerCase()}-${newId().slice(-10)}`;
  const created = await call("/communities", {
    method: "POST",
    cookie: owner.cookie,
    body: { name, slug },
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { community: { id: string } }).community.id;
  return { slug, id, owner };
}

const routeSweepTimeout = 120_000;
const agentScopes = availableScopes("owner", "agent");
const tokenScopes = availableScopes("owner", "token");

async function agentKey(tenant: Tenant, person: Person, granted: readonly string[]): Promise<Key> {
  const agent = await agents.createAgent(user(person.userId), tenant.id, {
    name: `Agent ${newId().slice(-6)}`,
    scopes: [...granted] as never[],
  });
  const issued = await agents.issueAgentToken(user(person.userId), tenant.id, agent.id, {
    name: "Key",
  });
  return { token: issued.token, agentId: agent.id, tokenId: issued.view.id };
}

async function personalKey(tenant: Tenant, person: Person, granted: readonly string[]) {
  const response = await call("/me/api-tokens", {
    method: "POST",
    cookie: person.cookie,
    body: { communityId: tenant.id, name: "Personal", scopes: granted },
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token: string; tokenInfo: { id: string } };
  return { token: body.token, tokenId: body.tokenInfo.id };
}

async function addPerson(tenant: Tenant, name: string, role: "admin" | "member") {
  const person = await signUp(name);
  await addMembership(withCommunity(db, parseCommunityId(tenant.id)), {
    userId: person.userId,
    role,
    status: "active",
  });
  return person;
}

async function setMembership(
  tenant: Tenant,
  userId: string,
  change: Partial<{ role: "admin" | "member"; status: "active" | "removed" }>,
) {
  await runInCommunity(withCommunity(db, parseCommunityId(tenant.id)), ({ tx, where }) =>
    tx
      .update(memberships)
      .set(change)
      .where(where(memberships, eq(memberships.userId, userId))),
  );
}

async function auditOf(tenant: Tenant, agentId: string) {
  return runInCommunity(withCommunity(db, parseCommunityId(tenant.id)), ({ tx, where }) =>
    tx
      .select()
      .from(auditLog)
      .where(where(auditLog, eq(auditLog.agentId, agentId)))
      .orderBy(auditLog.createdAt),
  );
}

async function pendingRequestsOf(agentId: string) {
  return db.select().from(approvalRequests).where(eq(approvalRequests.agentId, agentId));
}

function directCalls(): string[] {
  return recorded.filter((entry) => entry.via === "api").map((entry) => entry.name);
}

function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

beforeAll(async () => {
  tenantA = await createTenant("Alpha");
  tenantB = await createTenant("Beta");
  adminA = await addPerson(tenantA, "Ada Admin", "admin");
});

const sensitiveOperation =
  /refund|price|plan|comp(?!lete)|stripe|payment|billing|subscri|role|remove|ban|delete|export|transfer|archive|connect|owner|webhook/i;
const sensitiveAction =
  /^(payment\.(connect|edit_plan|refund|link_subscriptions)|membership\.(change_role|assign_admin|remove|ban|grant_comp)|community\.(delete|archive|transfer_ownership)|[a-z_]+\.delete$|export\.|migration\.export|audit_log\.export|webhook\.)/;

function classified(candidate: Operation): boolean {
  return candidate.action !== null && approvalActions[candidate.action] !== undefined;
}

describe("approval classification across every route (Phase 6 acceptance 1)", () => {
  it("classifies every money, role, removal, deletion, payment connection, and export route", () => {
    const unclassified = operations
      .filter(
        (candidate) =>
          (candidate.action !== null && sensitiveAction.test(candidate.action)) ||
          (candidate.method !== "GET" && sensitiveOperation.test(candidate.id)),
      )
      .filter((candidate) => !classified(candidate) && candidate.scope !== null)
      .map((candidate) => `${candidate.method} ${candidate.path} (${candidate.id})`);

    expect(operations.length).toBeGreaterThan(150);
    expect(unclassified).toEqual([]);
  });

  it("keeps every never grantable action off token routes unless agents must propose it", () => {
    const leaks = operations
      .filter(
        (candidate) =>
          candidate.scope !== null &&
          candidate.action !== null &&
          nonGrantableActions.has(candidate.action) &&
          !classified(candidate),
      )
      .map((candidate) => candidate.id);
    expect(leaks).toEqual([]);
  });

  it(
    "never runs a classified or session only operation for an agent token, even with every scope",
    async () => {
      const errors = silenceErrors();
      const problems: string[] = [];
      let proposed = 0;
      try {
        const targets = operations.filter(
          (candidate) =>
            candidate.id !== "getHealth" && (classified(candidate) || !candidate.scope),
        );
        expect(targets.length).toBeGreaterThan(60);
        for (const target of targets) {
          const key = await agentKey(tenantA, tenantA.owner, agentScopes);
          recorded.length = 0;
          const response = await call(pathFor(target, tenantA), {
            method: target.method,
            token: key.token,
            ...(target.method === "GET" ? {} : { body: {} }),
            app: probe,
          });
          const body = (await response.json()) as { status?: string; error?: { code: string } };
          const label = `${target.method} ${target.path} (${target.id})`;
          if (directCalls().length > 0) {
            problems.push(`${label} ran ${directCalls().join(", ")}`);
          }
          if (response.status === 202) {
            proposed += 1;
            if (body.status !== "pending_approval") problems.push(`${label} 202 without a request`);
            const requests = await pendingRequestsOf(key.agentId);
            if (requests.length !== 1 || requests[0]?.state !== "pending") {
              problems.push(`${label} 202 but ${requests.length} stored requests`);
            }
            continue;
          }
          const refusal = [403, 422].includes(response.status);
          if (!refusal) problems.push(`${label} answered ${response.status}`);
          if ((await pendingRequestsOf(key.agentId)).length > 0) {
            problems.push(`${label} stored a request but answered ${response.status}`);
          }
        }
      } finally {
        errors.mockRestore();
      }
      expect(problems).toEqual([]);
      expect(proposed).toBeGreaterThan(20);
    },
    routeSweepTimeout,
  );

  it("refuses archive, delete, and ownership transfer to an agent with every scope", async () => {
    const key = await agentKey(tenantA, tenantA.owner, agentScopes);
    const targets = operations.filter(
      (candidate) => candidate.action !== null && agentForbiddenActions.has(candidate.action),
    );
    expect(targets.map((target) => target.id).sort()).toEqual([
      "archiveCommunity",
      "deleteCommunity",
      "transferOwnership",
      "unarchiveCommunity",
    ]);
    const problems: string[] = [];
    for (const target of targets) {
      recorded.length = 0;
      const response = await call(pathFor(target, tenantA), {
        method: target.method,
        token: key.token,
        ...(target.method === "GET" ? {} : { body: {} }),
        app: probe,
      });
      const body = (await response.json()) as { error?: { code: string } };
      if (response.status !== 403 || body.error?.code !== "not_allowed_for_agents") {
        problems.push(`${target.id} answered ${response.status} ${body.error?.code ?? ""}`);
      }
      if (directCalls().length > 0) problems.push(`${target.id} ran ${directCalls().join(", ")}`);
    }
    expect(problems).toEqual([]);
    expect(await pendingRequestsOf(key.agentId)).toEqual([]);
  });

  it("refuses every classified operation without proposals:write and stores no request", async () => {
    const key = await agentKey(
      tenantA,
      tenantA.owner,
      agentScopes.filter((scope) => scope !== "proposals:write"),
    );
    const problems: string[] = [];
    for (const target of operations.filter(classified)) {
      recorded.length = 0;
      const response = await call(pathFor(target, tenantA), {
        method: target.method,
        token: key.token,
        ...(target.method === "GET" ? {} : { body: {} }),
        app: probe,
      });
      const body = (await response.json()) as { error?: { code: string } };
      if (response.status !== 403 || body.error?.code !== "approval_required") {
        problems.push(`${target.id} answered ${response.status} ${body.error?.code ?? ""}`);
      }
      if (directCalls().length > 0) problems.push(`${target.id} ran ${directCalls().join(", ")}`);
    }
    expect(problems).toEqual([]);
    expect(await pendingRequestsOf(key.agentId)).toEqual([]);
  });

  it("refuses session only and never grantable operations to a personal token with every scope", async () => {
    const { token } = await personalKey(tenantA, tenantA.owner, tokenScopes);
    const problems: string[] = [];
    const targets = operations.filter(
      (candidate) =>
        candidate.id !== "getHealth" &&
        (candidate.scope === null ||
          (candidate.action !== null && nonGrantableActions.has(candidate.action))),
    );
    for (const target of targets) {
      recorded.length = 0;
      const response = await call(pathFor(target, tenantA), {
        method: target.method,
        token,
        ...(target.method === "GET" ? {} : { body: {} }),
        app: probe,
      });
      const body = (await response.json()) as { error?: { code: string } };
      if (response.status !== 403 || body.error?.code !== "token_not_allowed") {
        problems.push(`${target.id} answered ${response.status} ${body.error?.code ?? ""}`);
      }
      if (directCalls().length > 0) problems.push(`${target.id} ran ${directCalls().join(", ")}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("audit trail of agent work (Phase 6 acceptance 2)", () => {
  it("records agent writes, requests, and decisions with the agent and its owning human", async () => {
    const key = await agentKey(tenantA, adminA, [
      "posts:read",
      "comments:write",
      "posts:write",
      "members:moderate",
      "proposals:write",
    ]);
    const post = await call(`/communities/${tenantA.slug}/posts`, {
      method: "POST",
      cookie: tenantA.owner.cookie,
      body: { title: "Audit", body: doc("Audit me") },
    });
    const postId = ((await post.json()) as { id: string }).id;
    const draft = await call(`/communities/${tenantA.slug}/posts`, {
      method: "POST",
      token: key.token,
      body: { title: "Draft", body: doc("From the agent") },
    });
    expect(draft.status).toBe(201);
    const comment = await call(`/communities/${tenantA.slug}/posts/${postId}/comments`, {
      method: "POST",
      token: key.token,
      body: { body: doc("Agent comment") },
    });
    expect(comment.status).toBe(201);
    const target = await addPerson(tenantA, "Rex Removed", "member");
    const proposal = await call(
      `/communities/${tenantA.slug}/manage/people/${target.userId}/remove`,
      { method: "POST", token: key.token },
    );
    expect(proposal.status).toBe(202);
    const { approvalId } = (await proposal.json()) as { approvalId: string };
    const rejected = await call(
      `/communities/${tenantA.slug}/manage/approvals/${approvalId}/reject`,
      { method: "POST", cookie: tenantA.owner.cookie, body: { note: "No" } },
    );
    expect(rejected.status).toBe(200);

    const trail = await auditOf(tenantA, key.agentId);
    const actions = trail.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["approval.requested", "approval.rejected"]));
    expect(trail.length).toBeGreaterThanOrEqual(4);
    const agentWrites = trail.filter((row) => row.actorType === "agent");
    expect(agentWrites.length).toBeGreaterThanOrEqual(3);
    for (const row of agentWrites) {
      expect(row).toMatchObject({ actorId: adminA.userId, via: "api", tokenId: key.tokenId });
    }
    const decision = trail.find((row) => row.action === "approval.rejected");
    expect(decision).toMatchObject({ actorId: tenantA.owner.userId, agentId: key.agentId });
    expect(decision?.metadata).toMatchObject({ ownerUserId: adminA.userId, agentId: key.agentId });
  });
});

describe("revocation takes effect on the next request (Phase 6 acceptance 3)", () => {
  const feed = () => `/communities/${tenantA.slug}/posts`;

  it("refuses a revoked personal token and a revoked agent token at once", async () => {
    const personal = await personalKey(tenantA, adminA, ["posts:read"]);
    expect((await call(feed(), { token: personal.token })).status).toBe(200);
    const revoke = await call(`/me/api-tokens/${personal.tokenId}`, {
      method: "DELETE",
      cookie: adminA.cookie,
    });
    expect(revoke.status).toBe(204);
    const afterPersonal = await call(feed(), { token: personal.token });
    expect(afterPersonal.status).toBe(401);
    expect(await afterPersonal.json()).toMatchObject({ error: { details: { reason: "revoked" } } });

    const key = await agentKey(tenantA, adminA, ["posts:read"]);
    expect((await call(feed(), { token: key.token })).status).toBe(200);
    const revokeToken = await call(
      `/communities/${tenantA.slug}/agents/${key.agentId}/tokens/${key.tokenId}`,
      { method: "DELETE", cookie: adminA.cookie },
    );
    expect(revokeToken.status).toBe(204);
    expect((await call(feed(), { token: key.token })).status).toBe(401);
  });

  it("refuses a paused agent at once and accepts it again when resumed", async () => {
    const key = await agentKey(tenantA, adminA, ["posts:read"]);
    expect((await call(feed(), { token: key.token })).status).toBe(200);
    const pause = await call(`/communities/${tenantA.slug}/agents/${key.agentId}`, {
      method: "PATCH",
      cookie: adminA.cookie,
      body: { status: "suspended" },
    });
    expect(pause.ok).toBe(true);
    const paused = await call(feed(), { token: key.token });
    expect(paused.status).toBe(401);
    expect(await paused.json()).toMatchObject({
      error: { details: { reason: "agent_suspended" } },
    });
    await call(`/communities/${tenantA.slug}/agents/${key.agentId}`, {
      method: "PATCH",
      cookie: adminA.cookie,
      body: { status: "active" },
    });
    expect((await call(feed(), { token: key.token })).status).toBe(200);
    await call(`/communities/${tenantA.slug}/agents/${key.agentId}`, {
      method: "DELETE",
      cookie: adminA.cookie,
    });
    expect((await call(feed(), { token: key.token })).status).toBe(401);
  });

  it("drops admin abilities when the owning human is demoted, and refuses all when removed", async () => {
    const person = await addPerson(tenantA, "Dee Demoted", "admin");
    const key = await agentKey(tenantA, person, ["settings:read", "posts:read"]);
    const personal = await personalKey(tenantA, person, ["settings:read", "posts:read"]);
    const settings = `/communities/${tenantA.slug}/manage/settings`;
    expect((await call(settings, { token: key.token })).status).toBe(200);
    expect((await call(settings, { token: personal.token })).status).toBe(200);

    await setMembership(tenantA, person.userId, { role: "member" });
    expect((await call(settings, { token: key.token })).status).toBe(403);
    expect((await call(settings, { token: personal.token })).status).toBe(403);
    expect((await call(feed(), { token: key.token })).status).toBe(200);

    await setMembership(tenantA, person.userId, { status: "removed" });
    const agentAfter = await call(feed(), { token: key.token });
    expect(agentAfter.status).toBe(401);
    expect(await agentAfter.json()).toMatchObject({
      error: { details: { reason: "agent_suspended" } },
    });
    const personalAfter = await call(feed(), { token: personal.token });
    expect(personalAfter.status).toBe(401);
    expect(await personalAfter.json()).toMatchObject({
      error: { details: { reason: "membership_required" } },
    });
  });
});

describe("tenant isolation for tokens (Phase 6 acceptance 4)", () => {
  it(
    "refuses every token route of another community for agent and personal tokens",
    async () => {
      const errors = silenceErrors();
      const agent = await agentKey(tenantA, tenantA.owner, agentScopes);
      const personal = await personalKey(tenantA, tenantA.owner, tokenScopes);
      const problems: string[] = [];
      try {
        for (const target of operations.filter((candidate) => candidate.scope !== null)) {
          for (const token of [agent.token, personal.token]) {
            recorded.length = 0;
            const response = await call(pathFor(target, tenantB), {
              method: target.method,
              token,
              ...(target.method === "GET" ? {} : { body: {} }),
              app: probe,
            });
            if (response.status !== 403) {
              problems.push(`${target.id} answered ${response.status}`);
            }
            if (recorded.length > 0) {
              problems.push(`${target.id} ran ${recorded.map((entry) => entry.name).join(", ")}`);
            }
          }
        }
      } finally {
        errors.mockRestore();
      }
      expect(problems).toEqual([]);
      expect(await pendingRequestsOf(agent.agentId)).toEqual([]);
    },
    routeSweepTimeout,
  );

  it("does not reach another community's posts, approvals, webhooks, or scheduled posts by id", async () => {
    const postB = await call(`/communities/${tenantB.slug}/posts`, {
      method: "POST",
      cookie: tenantB.owner.cookie,
      body: { title: "Beta only", body: doc("Beta only") },
    });
    const postId = ((await postB.json()) as { id: string }).id;
    const scheduledB = await call(`/communities/${tenantB.slug}/posts`, {
      method: "POST",
      cookie: tenantB.owner.cookie,
      body: {
        title: "Beta later",
        body: doc("Beta later"),
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(scheduledB.status).toBe(201);
    const scheduledId = ((await scheduledB.json()) as { id: string }).id;
    const hookB = await call(`/communities/${tenantB.slug}/manage/webhooks`, {
      method: "POST",
      cookie: tenantB.owner.cookie,
      body: { url: "https://hooks.example.test/beta", eventTypes: ["post.created"] },
    });
    expect(hookB.status).toBe(201);
    const endpointId = ((await hookB.json()) as { endpoint: { id: string } }).endpoint.id;
    const agentB = await agentKey(tenantB, tenantB.owner, ["proposals:write", "posts:write"]);
    const proposalB = await call(`/communities/${tenantB.slug}/posts/${postId}`, {
      method: "DELETE",
      token: agentB.token,
    });
    expect(proposalB.status).toBe(202);
    const approvalId = ((await proposalB.json()) as { approvalId: string }).approvalId;

    const agentA = await agentKey(tenantA, tenantA.owner, [
      "posts:read",
      "posts:write",
      "comments:read",
      "proposals:write",
    ]);
    const personalA = await personalKey(tenantA, tenantA.owner, tokenScopes);
    const a = tenantA.slug;
    const ids = { postId, approvalId, endpointId };
    for (const [id, token] of [
      ["getPost", agentA.token],
      ["listComments", agentA.token],
      ["getApprovalRequest", agentA.token],
      ["downloadApprovalResult", agentA.token],
      ["getWebhookEndpoint", personalA.token],
      ["listWebhookDeliveries", personalA.token],
      ["updatePost", personalA.token],
      ["updateScheduledPost", personalA.token],
      ["publishScheduledPost", personalA.token],
    ] as const) {
      const target = operation(id);
      const response = await call(
        pathFor(target, tenantA, {
          ...ids,
          postId: id.includes("Scheduled") ? scheduledId : postId,
        }),
        {
          method: target.method,
          token,
          ...(target.method === "GET" ? {} : { body: { title: "Hijacked", body: doc("x") } }),
        },
      );
      const unknown = id === "downloadApprovalResult" ? 410 : 404;
      expect([id, response.status]).toEqual([id, unknown]);
    }
    const listed = await call(`/communities/${a}/scheduled-posts`, { token: personalA.token });
    if (listed.status === 200) {
      expect(JSON.stringify(await listed.json())).not.toContain(scheduledId);
    }
    const hooks = await call(`/communities/${a}/manage/webhooks`, { token: personalA.token });
    expect(hooks.status).toBe(200);
    expect(JSON.stringify(await hooks.json())).not.toContain(endpointId);
    const requests = await call(`/communities/${a}/approvals`, { token: agentA.token });
    expect(requests.status).toBe(200);
    expect(JSON.stringify(await requests.json())).not.toContain(approvalId);
    const stillThere = await call(`/communities/${tenantB.slug}/posts/${postId}`, {
      cookie: tenantB.owner.cookie,
    });
    expect(stillThere.status).toBe(200);
  });
});

describe("content returned to tokens is marked as data (Phase 6 acceptance 5)", () => {
  it("describes rich text and lesson bodies as untrusted user data in the OpenAPI document", () => {
    expect(document.components.schemas.ContentDocument?.description).toMatch(/untrusted/i);
    expect(JSON.stringify(document.components.schemas)).toMatch(/Raw markdown\. Untrusted\./);
  });
});

describe("token secrecy (Phase 6 acceptance 7)", () => {
  it("shows a token once, stores only its hash, and never writes it to the logs", async () => {
    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(capture),
      vi.spyOn(console, "info").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture),
      vi.spyOn(console, "error").mockImplementation(capture),
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }),
    ];
    let secrets: string[] = [];
    try {
      const personal = await personalKey(tenantA, adminA, ["posts:read"]);
      const agent = await agentKey(tenantA, adminA, ["posts:read"]);
      secrets = [personal.token, agent.token];
      for (const token of secrets) {
        expect((await call(`/communities/${tenantA.slug}/posts`, { token })).status).toBe(200);
        expect((await call(`/communities/${tenantB.slug}/posts`, { token })).status).toBe(403);
        expect(
          (await call(`/communities/${tenantA.slug}/posts`, { token: `${token}x` })).status,
        ).toBe(401);
      }
      const listed = await call("/me/api-tokens", { cookie: adminA.cookie });
      expect(await listed.text()).not.toContain(personal.token);
      const agentsList = await call(`/communities/${tenantA.slug}/agents`, {
        cookie: adminA.cookie,
      });
      expect(await agentsList.text()).not.toContain(agent.token);
      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, personal.tokenId));
      expect(row?.tokenHash).toBe(createHash("sha256").update(personal.token).digest("hex"));
      expect(JSON.stringify(row)).not.toContain(personal.token);
      await call(`/me/api-tokens/${personal.tokenId}`, { method: "DELETE", cookie: adminA.cookie });
      expect(
        (await call(`/communities/${tenantA.slug}/posts`, { token: personal.token })).status,
      ).toBe(401);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const logged = output.join("\n");
    for (const token of secrets) {
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(token.slice("cohory_".length));
    }
  });
});

describe("rate limits for tokens and agents (Phase 6 acceptance 8)", () => {
  it("limits agent requests and agent writes with RateLimit headers and Retry-After", async () => {
    const limiter = createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        agentRequest: { max: 3, windowSeconds: 60 },
        agentWrite: { max: 1, windowSeconds: 3600 },
      },
    });
    const limited = createApi(() => realDeps(limiter));
    const reader = await agentKey(tenantA, adminA, ["posts:read"]);
    const feed = `/communities/${tenantA.slug}/posts`;
    for (const remaining of ["2", "1", "0"]) {
      const response = await call(feed, { token: reader.token, app: limited });
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-limit")).toBe("3");
      expect(response.headers.get("ratelimit-remaining")).toBe(remaining);
      expect(Number(response.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
    }
    const blocked = await call(feed, { token: reader.token, app: limited });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ error: { code: "rate_limited" } });

    const writer = await agentKey(tenantA, adminA, ["posts:read", "posts:write"]);
    const first = await call(feed, {
      method: "POST",
      token: writer.token,
      body: { title: "One", body: doc("One") },
      app: limited,
    });
    expect(first.status).toBe(201);
    const second = await call(feed, {
      method: "POST",
      token: writer.token,
      body: { title: "Two", body: doc("Two") },
      app: limited,
    });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    const drafts = await runInCommunity(
      withCommunity(db, parseCommunityId(tenantA.id)),
      ({ tx, where }) =>
        tx
          .select()
          .from(auditLog)
          .where(where(auditLog, and(eq(auditLog.agentId, writer.agentId)))),
    );
    expect(drafts.filter((row) => row.actorType === "agent")).toHaveLength(1);
  });
});
