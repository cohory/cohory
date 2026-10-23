import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService } from "@cohory/agents";
import { createApprovalsService } from "@cohory/agents/approvals";
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
import { approvalRequests, auditLog, communities, memberships, posts } from "@cohory/db/schema";
import { createApprovalNotifier } from "@cohory/notifications";
import type { PlanView } from "@cohory/payments";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { createWebhooksService } from "@cohory/webhooks";
import { and, eq, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi, type ApiDeps } from "./app";
import { betterAuthSessionResolver, type SessionResolver } from "./middleware/session";
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
const payments = createPaymentsStub();
const webhooks = createWebhooksService({
  db,
  key: () => Buffer.alloc(32, 7),
  queue: { enqueue: async () => undefined },
});
const sessions = betterAuthSessionResolver(auth);

function deps(resolveSession: SessionResolver): ApiDeps {
  return apiDeps({
    resolveSession,
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
    payments,
    webhooks,
    rateLimiter: createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        agentRequest: { max: 1000, windowSeconds: 60 },
        agentWrite: { max: 1000, windowSeconds: 3600 },
      },
    }),
  });
}

const api = createApi(() => deps(sessions));
const staleApi = createApi(() =>
  deps(async (headers) => {
    const session = await sessions(headers);
    return session ? { ...session, signedInAt: new Date(Date.now() - 11 * 60 * 1000) } : null;
  }),
);

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

interface AgentKey {
  readonly token: string;
  readonly agentId: string;
  readonly tokenId: string;
}

let owner: Person;
let admin: Person;
let moderator: Person;
let slug = "";
let otherSlug = "";
let communityId = "";
let helper: AgentKey;

afterAll(async () => {
  await pool.end();
});

async function signUp(name: string): Promise<Person> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `approvals-${newId()}@example.test`,
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
  init: { method?: string; cookie?: string; token?: string; body?: unknown; app?: typeof api } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return Promise.resolve(
    (init.app ?? api).request(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function addPerson(name: string, role: "admin" | "moderator" | "member"): Promise<Person> {
  const person = await signUp(name);
  await addMembership(withCommunity(db, parseCommunityId(communityId)), {
    userId: person.userId,
    role,
    status: "active",
  });
  return person;
}

async function agentKey(person: Person, scopes: string[]): Promise<AgentKey> {
  const agent = await call(`/communities/${slug}/agents`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: `Helper ${newId().slice(-4)}`, scopes },
  });
  expect(agent.status).toBe(201);
  const { id: agentId } = (await agent.json()) as { id: string };
  const issued = await call(`/communities/${slug}/agents/${agentId}/tokens`, {
    method: "POST",
    cookie: person.cookie,
    body: { name: "Key" },
  });
  const body = (await issued.json()) as { token: string; tokenInfo: { id: string } };
  return { token: body.token, agentId, tokenId: body.tokenInfo.id };
}

async function propose(path: string, method: string, body?: unknown, key = helper) {
  const response = await call(path, { method, token: key.token, body });
  expect(response.status).toBe(202);
  const pending = (await response.json()) as {
    status: string;
    approvalId: string;
    summary: string;
    statusUrl: string;
  };
  expect(pending.status).toBe("pending_approval");
  return pending;
}

interface Decision {
  approval: { state: string; errorCode: string | null; result: Record<string, unknown> | null };
  revealed: Record<string, string> | null;
}

async function approve(approvalId: string, person = owner, app = api) {
  return call(`/communities/${slug}/manage/approvals/${approvalId}/approve`, {
    method: "POST",
    cookie: person.cookie,
    app,
  });
}

async function approveOk(approvalId: string): Promise<Decision> {
  const response = await approve(approvalId);
  expect(response.status).toBe(200);
  return (await response.json()) as Decision;
}

async function membershipOf(userId: string) {
  return runInCommunity(withCommunity(db, parseCommunityId(communityId)), async ({ tx, where }) => {
    const [row] = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(where(memberships, eq(memberships.userId, userId)));
    return row ?? null;
  });
}

async function auditOf(condition: SQL | undefined) {
  return runInCommunity(withCommunity(db, parseCommunityId(communityId)), ({ tx, where }) =>
    tx.select().from(auditLog).where(where(auditLog, condition)).orderBy(auditLog.createdAt),
  );
}

async function ownerPost(text: string): Promise<string> {
  const created = await call(`/communities/${slug}/posts`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: text, body: doc(text) },
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

beforeAll(async () => {
  owner = await signUp("Olive Owner");
  slug = `appr-${newId().slice(-12)}`;
  otherSlug = `appr-other-${newId().slice(-12)}`;
  const created = await call("/communities", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Approvals", slug },
  });
  expect(created.status).toBe(201);
  communityId = ((await created.json()) as { community: { id: string } }).community.id;
  expect(
    (
      await call("/communities", {
        method: "POST",
        cookie: owner.cookie,
        body: { name: "Other", slug: otherSlug },
      })
    ).status,
  ).toBe(201);
  admin = await addPerson("Ada Admin", "admin");
  moderator = await addPerson("Mo Moderator", "moderator");
  helper = await agentKey(admin, [
    "proposals:write",
    "posts:read",
    "posts:write",
    "comments:write",
    "members:moderate",
    "courses:write",
    "payments:read",
  ]);
});

beforeEach(() => {
  payments.upsertPlan.mockReset();
  payments.getPlan.mockReset();
  payments.connectStripe.mockReset();
});

describe("member removal through the approval queue", () => {
  it("records a request that changes nothing, then runs exactly once as the approver", async () => {
    const target = await addPerson("Sam Lee", "member");

    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/remove`,
      "POST",
    );

    expect(pending.summary).toBe("remove Sam Lee from the community");
    expect(pending.statusUrl).toBe(`/api/v1/communities/${slug}/approvals/${pending.approvalId}`);
    expect((await membershipOf(target.userId))?.status).toBe("active");
    const status = await call(`/communities/${slug}/approvals/${pending.approvalId}`, {
      token: helper.token,
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      state: "pending",
      agent: { id: helper.agentId },
      owner: { id: admin.userId, name: "Ada Admin" },
      diff: [{ label: "Membership", before: "Member", after: "Removed" }],
    });
    const queue = await call(`/communities/${slug}/manage/approvals`, { cookie: owner.cookie });
    const listed = (await queue.json()) as { data: { id: string }[] };
    expect(listed.data.map((item) => item.id)).toContain(pending.approvalId);

    const [first, second] = await Promise.all([
      approve(pending.approvalId),
      approve(pending.approvalId),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const after = await call(`/communities/${slug}/approvals/${pending.approvalId}`, {
      token: helper.token,
    });
    expect(await after.json()).toMatchObject({
      state: "executed",
      decidedBy: { id: owner.userId },
    });
    expect((await membershipOf(target.userId))?.status).not.toBe("active");

    const removals = await auditOf(
      and(eq(auditLog.action, "member.removed"), eq(auditLog.target, target.userId)),
    );
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({
      actorId: owner.userId,
      actorType: "user",
      agentId: helper.agentId,
    });
    const trail = await auditOf(eq(auditLog.target, pending.approvalId));
    expect(trail.map((row) => row.action)).toEqual([
      "approval.requested",
      "approval.approved",
      "approval.executed",
    ]);
    expect(trail[0]).toMatchObject({
      actorId: admin.userId,
      actorType: "agent",
      via: "api",
      agentId: helper.agentId,
      tokenId: helper.tokenId,
    });
    expect(trail[1]).toMatchObject({ actorId: owner.userId, agentId: helper.agentId });
    expect(trail[2]?.metadata).toMatchObject({
      agentId: helper.agentId,
      ownerUserId: admin.userId,
    });
  });

  it("refuses an approver without permission, a stale sign in, and the agent itself", async () => {
    const target = await addPerson("Kim Park", "member");
    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/ban`,
      "POST",
    );

    const byModerator = await approve(pending.approvalId, moderator);
    expect(byModerator.status).toBe(403);
    const stale = await approve(pending.approvalId, owner, staleApi);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    const byAgent = await call(
      `/communities/${slug}/manage/approvals/${pending.approvalId}/approve`,
      { method: "POST", token: helper.token },
    );
    expect(byAgent.status).toBe(403);
    expect((await membershipOf(target.userId))?.status).toBe("active");

    const decision = await approveOk(pending.approvalId);
    expect(decision.approval.state).toBe("executed");
    expect((await membershipOf(target.userId))?.status).toBe("banned");
  });

  it("rejects without running and shows the note to the agent", async () => {
    const target = await addPerson("Lou Reed", "member");
    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/remove`,
      "POST",
    );

    const rejected = await call(
      `/communities/${slug}/manage/approvals/${pending.approvalId}/reject`,
      { method: "POST", cookie: admin.cookie, body: { note: "Keep Lou" } },
    );
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ state: "rejected", decisionNote: "Keep Lou" });
    expect((await approveOk(pending.approvalId)).approval.state).toBe("rejected");
    expect((await membershipOf(target.userId))?.status).toBe("active");
  });

  it("rejects the request when the agent is revoked before anyone approves", async () => {
    const key = await agentKey(admin, ["proposals:write", "members:moderate"]);
    const target = await addPerson("Pat Doe", "member");
    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/remove`,
      "POST",
      undefined,
      key,
    );
    await call(`/communities/${slug}/agents/${key.agentId}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });

    const response = await approve(pending.approvalId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "agent_inactive" } });
    expect((await membershipOf(target.userId))?.status).toBe("active");
  });

  it("keeps requests inside their community", async () => {
    const target = await addPerson("Ray Cross", "member");
    const wrong = await call(`/communities/${otherSlug}/manage/people/${target.userId}/remove`, {
      method: "POST",
      token: helper.token,
    });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: { code: "wrong_community" } });
    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/remove`,
      "POST",
    );
    const elsewhere = await call(
      `/communities/${otherSlug}/manage/approvals/${pending.approvalId}/approve`,
      { method: "POST", cookie: owner.cookie },
    );
    expect(elsewhere.status).toBe(404);
    expect((await membershipOf(target.userId))?.status).toBe("active");
  });
});

describe("other categories", () => {
  it("changes a role", async () => {
    const target = await addPerson("Rita Role", "member");
    const pending = await propose(
      `/communities/${slug}/manage/people/${target.userId}/role`,
      "PATCH",
      { role: "moderator" },
    );
    expect(pending.summary).toBe("make Rita Role a moderator");
    expect((await membershipOf(target.userId))?.role).toBe("member");

    await approveOk(pending.approvalId);
    expect((await membershipOf(target.userId))?.role).toBe("moderator");
  });

  it("deletes someone else's post and comment", async () => {
    const postId = await ownerPost("Spam looking post");
    const comment = await call(`/communities/${slug}/posts/${postId}/comments`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: doc("A comment") },
    });
    const { id: commentId } = (await comment.json()) as { id: string };

    const postRequest = await propose(`/communities/${slug}/posts/${postId}`, "DELETE");
    const commentRequest = await propose(`/communities/${slug}/comments/${commentId}`, "DELETE");
    expect(postRequest.summary).toContain('delete the post "Spam looking post" by Olive Owner');

    await approveOk(commentRequest.approvalId);
    await approveOk(postRequest.approvalId);
    const [row] = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx, where }) =>
        tx
          .select({ deletedAt: posts.deletedAt })
          .from(posts)
          .where(where(posts, eq(posts.id, postId))),
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  it("publishes a course", async () => {
    const created = await call(`/communities/${slug}/courses`, {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Agent written course" },
    });
    expect(created.status).toBe(201);
    const course = (await created.json()) as { slug: string; status: string };
    const module = (await (
      await call(`/communities/${slug}/courses/${course.slug}/modules`, {
        method: "POST",
        cookie: owner.cookie,
        body: { title: "Basics" },
      })
    ).json()) as { id: string };
    const lesson = (await (
      await call(`/communities/${slug}/courses/${course.slug}/modules/${module.id}/lessons`, {
        method: "POST",
        cookie: owner.cookie,
        body: { title: "Welcome" },
      })
    ).json()) as { id: string };
    await call(`/communities/${slug}/lessons/${lesson.id}/publish`, {
      method: "POST",
      cookie: owner.cookie,
    });

    const pending = await propose(`/communities/${slug}/courses/${course.slug}/publish`, "POST");
    expect(pending.summary).toBe('publish the course "Agent written course"');

    const decision = await approveOk(pending.approvalId);
    expect(decision.approval.state).toBe("executed");
    const after = await call(`/communities/${slug}/courses/${course.slug}`, {
      cookie: owner.cookie,
    });
    expect(await after.json()).toMatchObject({ status: "published" });
  });

  it("changes the membership price through the payments service once, as the owner", async () => {
    const plan: PlanView = {
      id: newId(),
      name: "Membership",
      currency: "usd",
      monthlyPriceMinor: 2500,
      annualPriceMinor: null,
      purchasable: true,
      providerName: "Stripe",
      archivedAt: null,
      createdAt: new Date(),
    };
    payments.getPlan.mockResolvedValue(plan);
    payments.upsertPlan.mockResolvedValue({ ...plan, monthlyPriceMinor: 3900 });

    const pending = await propose(`/communities/${communityId}/payments/plan`, "PUT", {
      currency: "usd",
      monthlyPriceMinor: 3900,
    });
    expect(pending.summary).toBe("set the membership price to $39.00 a month");
    const detail = await call(`/communities/${slug}/approvals/${pending.approvalId}`, {
      token: helper.token,
    });
    expect(await detail.json()).toMatchObject({
      diff: expect.arrayContaining([{ label: "Monthly price", before: "$25.00", after: "$39.00" }]),
    });
    expect(payments.upsertPlan).not.toHaveBeenCalled();

    await approveOk(pending.approvalId);
    await approveOk(pending.approvalId);
    expect(payments.upsertPlan).toHaveBeenCalledOnce();
    expect(payments.upsertPlan.mock.calls[0]?.[0]).toMatchObject({
      kind: "user",
      userId: owner.userId,
    });
    expect(payments.upsertPlan.mock.calls[0]?.[0]).not.toHaveProperty("credential");
  });

  it("refuses an admin approving an owner only change and keeps it pending", async () => {
    const pending = await propose(`/communities/${communityId}/payments/plan`, "PUT", {
      currency: "usd",
      monthlyPriceMinor: 100,
    });
    const response = await approve(pending.approvalId, admin);
    expect(response.status).toBe(403);
    const view = await call(`/communities/${slug}/approvals/${pending.approvalId}`, {
      token: helper.token,
    });
    expect(await view.json()).toMatchObject({ state: "pending" });
    expect(payments.upsertPlan).not.toHaveBeenCalled();
  });

  it("schedules a post written by an agent", async () => {
    const at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const pending = await propose(`/communities/${slug}/posts`, "POST", {
      title: "Monday call",
      body: doc("See you Monday"),
      scheduledAt: at,
    });

    const decision = await approveOk(pending.approvalId);
    expect(decision.approval.state).toBe("executed");
    const scheduled = await call(`/communities/${slug}/scheduled-posts`, { cookie: owner.cookie });
    const list = (await scheduled.json()) as { data: { title: string | null }[] };
    expect(list.data.map((item) => item.title)).toContain("Monday call");
  });

  it("adds a webhook endpoint and shows the secret once to the approver only", async () => {
    const key = await agentKey(owner, ["proposals:write", "webhooks:write"]);
    const pending = await propose(
      `/communities/${slug}/manage/webhooks`,
      "POST",
      { url: "https://hooks.example.test/cohory", eventTypes: ["post.created"] },
      key,
    );
    expect(pending.summary).toBe("send community events to https://hooks.example.test/cohory");

    const decision = await approveOk(pending.approvalId);
    expect(decision.revealed?.secret).toMatch(/^whsec_/);
    expect(JSON.stringify(decision.approval.result)).not.toContain("whsec_");
    const listed = await call(`/communities/${slug}/manage/webhooks`, { cookie: owner.cookie });
    const endpoints = (await listed.json()) as { data: { url: string }[] };
    expect(endpoints.data.map((item) => item.url)).toContain("https://hooks.example.test/cohory");
  });

  it("hands the approved members spreadsheet to the agent once", async () => {
    const key = await agentKey(owner, ["proposals:write", "members:export"]);
    const pending = await propose(
      `/communities/${slug}/manage/export/members.csv`,
      "GET",
      undefined,
      key,
    );

    const early = await call(`/communities/${slug}/approvals/${pending.approvalId}/download`, {
      token: key.token,
    });
    expect(early.status).toBe(410);
    const decision = await approveOk(pending.approvalId);
    expect(decision.approval.state).toBe("executed");

    const file = await call(`/communities/${slug}/approvals/${pending.approvalId}/download`, {
      token: key.token,
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("text/csv");
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect(await file.text()).toContain("Olive Owner");
    const again = await call(`/communities/${slug}/approvals/${pending.approvalId}/download`, {
      token: key.token,
    });
    expect(again.status).toBe(410);
  });

  it("creates a request for an operation it cannot run yet and says so on approval", async () => {
    const key = await agentKey(owner, ["proposals:write", "payments:read"]);
    const pending = await propose(`/communities/${communityId}/payments/connect`, "POST", {}, key);

    const decision = await approveOk(pending.approvalId);
    expect(decision.approval).toMatchObject({ state: "failed", errorCode: "not_supported" });
    expect(payments.connectStripe).not.toHaveBeenCalled();
  });
});

describe("requests agents can no longer make", () => {
  it("refuses an archive, deletion, or ownership transfer an agent proposed before agents were refused", async () => {
    const key = await agentKey(owner, ["proposals:write", "settings:read"]);
    const legacy = [
      { operationId: "archiveCommunity", method: "POST", path: "manage/archive", body: null },
      { operationId: "deleteCommunity", method: "DELETE", path: "manage", body: null },
      {
        operationId: "transferOwnership",
        method: "POST",
        path: "manage/transfer",
        body: { userId: admin.userId },
      },
    ];
    const ids = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      async ({ tx }) => {
        const rows = await tx
          .insert(approvalRequests)
          .values(
            legacy.map((entry) => ({
              communityId,
              agentId: key.agentId,
              ownerId: owner.userId,
              tokenId: key.tokenId,
              operationId: entry.operationId,
              method: entry.method,
              path: `/api/v1/communities/${slug}/${entry.path}`,
              category: entry.operationId === "transferOwnership" ? "ownership" : "deletion",
              input: { params: {}, query: {}, body: entry.body },
              summary: `legacy ${entry.operationId}`,
              diff: [],
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            })),
          )
          .returning({ id: approvalRequests.id });
        return rows.map((row) => row.id);
      },
    );

    for (const id of ids) {
      const decision = await approveOk(id);
      expect(decision.approval).toMatchObject({
        state: "failed",
        errorCode: "not_allowed_for_agents",
      });
    }
    const [community] = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx }) =>
        tx
          .select({ archivedAt: communities.archivedAt, deletedAt: communities.deletedAt })
          .from(communities)
          .where(eq(communities.id, communityId)),
    );
    expect(community).toEqual({ archivedAt: null, deletedAt: null });
    expect((await membershipOf(owner.userId))?.role).toBe("owner");
    expect((await membershipOf(admin.userId))?.role).toBe("admin");
  });
});

describe("proposals stay inside the token's community", () => {
  it("refuses encoded path segments that point at another community and reads nothing there", async () => {
    const key = await agentKey(owner, [
      "proposals:write",
      "courses:write",
      "events:write",
      "members:moderate",
    ]);
    const secret = await call(`/communities/${otherSlug}/courses`, {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Secret other draft" },
    });
    expect(secret.status).toBe(201);
    const { slug: secretSlug } = (await secret.json()) as { slug: string };
    const escape = `..%2F..%2F${otherSlug}%2Fcourses%2F${secretSlug}`;
    const attempts = [
      { method: "DELETE", path: `/communities/${slug}/courses/${escape}` },
      { method: "POST", path: `/communities/${slug}/courses/${escape}/publish` },
      { method: "DELETE", path: `/communities/${slug}/calendar/events/${escape}` },
      {
        method: "POST",
        path: `/communities/${slug}/manage/people/..%2F..%2F..%2F${otherSlug}%2Fmembers%2F${owner.userId}/remove`,
      },
    ];

    for (const attempt of attempts) {
      const response = await call(attempt.path, { method: attempt.method, token: key.token });
      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).not.toContain("Secret other draft");
    }
    const queued = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx, where }) =>
        tx
          .select({ summary: approvalRequests.summary })
          .from(approvalRequests)
          .where(where(approvalRequests, eq(approvalRequests.agentId, key.agentId))),
    );
    expect(queued).toEqual([]);
  });
});

describe("recorded input is what runs", () => {
  it("records and shows only the settings fields the route keeps", async () => {
    const key = await agentKey(owner, ["proposals:write", "settings:read"]);
    const junk = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`x${index}`, "noise"]),
    );
    const response = await call(`/communities/${slug}/manage/settings`, {
      method: "PATCH",
      token: key.token,
      body: { ...junk, "privacy ": "private", description: "Shown in the diff" },
    });
    expect(response.status).toBe(202);
    const { approvalId } = (await response.json()) as { approvalId: string };

    const [row] = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx, where }) =>
        tx
          .select({ input: approvalRequests.input, diff: approvalRequests.diff })
          .from(approvalRequests)
          .where(where(approvalRequests, eq(approvalRequests.id, approvalId))),
    );
    expect(row?.input.body).toEqual({ description: "Shown in the diff" });
    expect(row?.diff).toEqual([{ label: "Description", before: null, after: "Shown in the diff" }]);

    const decision = await approveOk(approvalId);
    expect(decision.approval.state).toBe("executed");
    const settings = await call(`/communities/${slug}/manage/settings`, { cookie: owner.cookie });
    expect(await settings.json()).toMatchObject({
      description: "Shown in the diff",
      privacy: "private",
    });
  });

  it("still validates a request stored with its raw body before inputs were normalized", async () => {
    const key = await agentKey(owner, ["proposals:write", "settings:read"]);
    const [stored] = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx }) =>
        tx
          .insert(approvalRequests)
          .values({
            communityId,
            agentId: key.agentId,
            ownerId: owner.userId,
            tokenId: key.tokenId,
            operationId: "updateCommunitySettings",
            method: "PATCH",
            path: `/api/v1/communities/${slug}/manage/settings`,
            category: "settings",
            input: {
              params: { slug },
              query: {},
              body: { description: "Legacy text", junk: true },
            },
            summary: "change the community settings",
            diff: [{ label: "Description", before: null, after: "Legacy text" }],
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          })
          .returning({ id: approvalRequests.id }),
    );
    if (!stored) throw new Error("no legacy request");

    const decision = await approveOk(stored.id);
    expect(decision.approval.state).toBe("executed");
    const settings = await call(`/communities/${slug}/manage/settings`, { cookie: owner.cookie });
    expect(await settings.json()).toMatchObject({ description: "Legacy text" });
  });
});

describe("limits", () => {
  it("answers 429 after 20 pending requests from one agent", async () => {
    const key = await agentKey(admin, ["proposals:write", "posts:write"]);
    const postId = await ownerPost("Keep me");
    for (let index = 0; index < 20; index += 1) {
      await propose(`/communities/${slug}/posts/${postId}`, "DELETE", undefined, key);
    }
    const refused = await call(`/communities/${slug}/posts/${postId}`, {
      method: "DELETE",
      token: key.token,
    });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "limit_reached" } });
  });
});

describe("agent capabilities from the high priority list", () => {
  it("covers search, drafts, inactive members, events, payment reads, and settings proposals", async () => {
    payments.listSubscriptions.mockResolvedValue([]);
    const key = await agentKey(owner, [
      "posts:read",
      "posts:write",
      "members:read",
      "events:write",
      "payments:read",
      "settings:read",
      "proposals:write",
    ]);
    await ownerPost("Pricing questions from members");

    const search = await call(`/communities/${slug}/search?q=pricing`, { token: key.token });
    expect(search.status).toBe(200);
    const draft = await call(`/communities/${slug}/posts`, {
      method: "POST",
      token: key.token,
      body: { title: "Monday announcement", body: doc("Draft by an agent") },
    });
    expect(draft.status).toBe(201);
    expect(await draft.json()).toMatchObject({ status: "draft" });
    const inactive = await call(`/communities/${slug}/manage/people?inactiveDays=30`, {
      token: key.token,
    });
    expect(inactive.status).toBe(200);
    const event = await call(`/communities/${slug}/calendar/events`, {
      method: "POST",
      token: key.token,
      body: {
        title: "Weekly group call",
        startsAtLocal: "2027-01-04T17:00",
        timeZone: "UTC",
        durationMinutes: 60,
        recurrence: "weekly",
      },
    });
    expect(event.status).toBe(201);
    const { slug: eventSlug } = (await event.json()) as { slug: string };
    const subscriptions = await call(`/communities/${communityId}/payments/subscriptions`, {
      token: key.token,
    });
    expect(subscriptions.status).toBe(200);

    const cancelSeries = await call(`/communities/${slug}/calendar/events/${eventSlug}`, {
      method: "DELETE",
      token: key.token,
    });
    expect(cancelSeries.status).toBe(202);
    const settings = await call(`/communities/${slug}/manage/settings`, {
      method: "PATCH",
      token: key.token,
      body: { name: "Approvals renamed" },
    });
    expect(settings.status).toBe(202);
    const { approvalId } = (await settings.json()) as { approvalId: string };
    const detail = await call(`/communities/${slug}/approvals/${approvalId}`, {
      token: key.token,
    });
    expect(await detail.json()).toMatchObject({
      summary: "change the community settings",
      diff: [{ label: "Name", before: "Approvals", after: "Approvals renamed" }],
    });
    const plan = await call(`/communities/${communityId}/payments/plan`, {
      method: "PUT",
      token: key.token,
      body: { currency: "usd", monthlyPriceMinor: 500 },
    });
    expect(plan.status).toBe(202);
  });
});

describe("learning point settings over REST", () => {
  it("lets an admin turn on points for lessons and events and refuses a moderator", async () => {
    const path = `/communities/${slug}/manage/settings`;
    const denied = await call(path, {
      method: "PATCH",
      cookie: moderator.cookie,
      body: { pointsForLessons: true },
    });
    expect(denied.status).toBe(403);

    const saved = await call(path, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { pointsForLessons: true, pointsForEvents: true },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ pointsForLessons: true, pointsForEvents: true });

    const read = await call(path, { cookie: owner.cookie });
    expect(await read.json()).toMatchObject({ pointsForLessons: true, pointsForEvents: true });
  });
});
