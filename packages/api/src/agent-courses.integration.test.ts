import { signUpWithSession } from "@cohory/auth/testing";
import { createAgentsService } from "@cohory/agents";
import { createApprovalsService } from "@cohory/agents/approvals";
import { createAuth, createAuthOptions } from "@cohory/auth";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import { createCoursesService, createPostgresCoursesRepository } from "@cohory/courses";
import {
  addMembership,
  createDb,
  createPool,
  getMembership,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  runInCommunity,
  setMembershipStatus,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { auditLog } from "@cohory/db/schema";
import { createEntitlementsService, type MembershipAccessReader } from "@cohory/entitlements";
import { createAgentAccessNotifier, createApprovalNotifier } from "@cohory/notifications";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi, type ApiDeps } from "./app";
import { betterAuthSessionResolver } from "./middleware/session";
import { publishAgentMaterial } from "./test/agent-material-fixture";
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
const approvals = createApprovalsService({
  db,
  notify: createApprovalNotifier({ db }),
  notifyBuyer: createAgentAccessNotifier({ db }),
});
const payments = createPaymentsStub();
const membershipAccess: MembershipAccessReader = async (communityId, userId) => {
  const membership = await getMembership(withCommunity(db, communityId as CommunityId), userId);
  if (membership?.status !== "active") {
    return { level: "not_member" };
  }
  return membership.role === "member"
    ? { level: "member", source: "membership" }
    : { level: "staff", role: membership.role };
};
const entitlements = createEntitlementsService({
  db,
  membershipAccess,
  agents: {
    find: (communityId, agentId) => agents.findAgent(communityId, agentId),
    list: (communityId, filter) => agents.agentSummaries(communityId, filter),
  },
});
const courses = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage: {
    put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
    get: async () => null,
  },
  agentAccess: entitlements,
});

function deps(): ApiDeps {
  return apiDeps({
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
    payments,
    courses,
    entitlements,
    rateLimiter: createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        agentRequest: { max: 1000, windowSeconds: 60 },
        agentWrite: { max: 1000, windowSeconds: 3600 },
      },
    }),
  });
}

const api = createApi(deps);

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

let owner: Person;
let member: Person;
let slug = "";
let communityId = "";
let course = { id: "", slug: "" };
let agentId = "";
let agentToken = "";

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
        email: `agent-courses-${newId()}@example.test`,
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

async function json<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

beforeAll(async () => {
  owner = await signUp("Olive Owner");
  member = await signUp("Mia Member");
  slug = `agentc-${newId().slice(-12)}`;
  communityId = (
    await json<{ community: { id: string } }>(
      await call("/communities", {
        method: "POST",
        cookie: owner.cookie,
        body: { name: "Agent courses", slug },
      }),
      201,
    )
  ).community.id;
  await addMembership(withCommunity(db, parseCommunityId(communityId)), {
    userId: member.userId,
    role: "member",
    status: "active",
  });
  course = await json<{ id: string; slug: string }>(
    await call(`/communities/${slug}/courses`, {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Agents 101" },
    }),
    201,
  );
  const module = await json<{ id: string }>(
    await call(`/communities/${slug}/courses/${course.slug}/modules`, {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Basics" },
    }),
    201,
  );
  const lesson = await json<{ id: string }>(
    await call(`/communities/${slug}/courses/${course.slug}/modules/${module.id}/lessons`, {
      method: "POST",
      cookie: owner.cookie,
      body: { title: "Welcome" },
    }),
    201,
  );
  await json(
    await call(`/communities/${slug}/lessons/${lesson.id}/publish`, {
      method: "POST",
      cookie: owner.cookie,
    }),
    200,
  );
  await json(
    await call(`/communities/${slug}/courses/${course.slug}/publish`, {
      method: "POST",
      cookie: owner.cookie,
    }),
    200,
  );
  agentId = (
    await json<{ id: string }>(
      await call(`/communities/${slug}/agents`, {
        method: "POST",
        cookie: member.cookie,
        body: { name: "Study buddy", scopes: ["courses:read", "proposals:write"] },
      }),
      201,
    )
  ).id;
  agentToken = (
    await json<{ token: string }>(
      await call(`/communities/${slug}/agents/${agentId}/tokens`, {
        method: "POST",
        cookie: member.cookie,
        body: { name: "Key" },
      }),
      201,
    )
  ).token;
});

describe("delegated course access over the API", () => {
  it("refuses members personal agents with write scopes", async () => {
    const refused = await call(`/communities/${slug}/agents`, {
      method: "POST",
      cookie: member.cookie,
      body: { name: "Poster", scopes: ["posts:write"] },
    });
    expect(refused.status).toBe(422);
  });

  it("lets the creator opt in, the member delegate, the agent read, and revocation stop it", async () => {
    const before = await call(`/communities/${slug}/courses/${course.slug}`, {
      token: agentToken,
    });
    expect(before.status).toBe(403);
    expect(await before.json()).toMatchObject({
      error: { code: "delegation_required", details: { reason: "agent_access_off" } },
    });

    const memberOptIn = await call(`/communities/${slug}/courses/${course.id}/agent-access`, {
      method: "PUT",
      cookie: member.cookie,
      body: { allowAgentAccess: true, licenseId: "personal_agents" },
    });
    expect(memberOptIn.status).toBe(403);
    const settings = await json<{ allowAgentAccess: boolean; license: { label: string } }>(
      await call(`/communities/${slug}/courses/${course.id}/agent-access`, {
        method: "PUT",
        cookie: owner.cookie,
        body: { allowAgentAccess: true, licenseId: "personal_agents" },
      }),
      200,
    );
    expect(settings.license.label).toBe("Personal use by the buyer's agents only");

    const access = await json<{ canDelegate: boolean; agents: { id: string }[] }>(
      await call(`/communities/${slug}/courses/${course.id}/agent-access`, {
        cookie: member.cookie,
      }),
      200,
    );
    expect(access.canDelegate).toBe(true);
    expect(access.agents.map((agent) => agent.id)).toEqual([agentId]);

    const byAgent = await call(`/communities/${slug}/delegations`, {
      method: "POST",
      token: agentToken,
      body: { courseId: course.id, agentId },
    });
    expect(byAgent.status).toBe(403);

    const delegation = await json<{ id: string; state: { kind: string } }>(
      await call(`/communities/${slug}/delegations`, {
        method: "POST",
        cookie: member.cookie,
        body: { courseId: course.id, agentId },
      }),
      201,
    );
    expect(delegation.state.kind).toBe("active");

    const read = await json<{ id: string }>(
      await call(`/communities/${slug}/courses/${course.slug}`, { token: agentToken }),
      200,
    );
    expect(read.id).toBe(course.id);

    const material = await publishAgentMaterial(call, slug, course.slug, owner.cookie);
    const result = {
      lessonId: material.lessonId,
      taskId: material.taskId,
      version: material.version,
      runId: "r1",
      payload: { ok: 1 },
    };
    const unknownTask = await call(`/communities/${slug}/courses/${course.id}/submissions`, {
      method: "POST",
      token: agentToken,
      body: { ...result, taskId: "no-such-task" },
    });
    expect(unknownTask.status).toBe(404);

    const submitted = await json<{ label: string; agent: { id: string } }>(
      await call(`/communities/${slug}/courses/${course.id}/submissions`, {
        method: "POST",
        token: agentToken,
        body: result,
      }),
      201,
    );
    expect(submitted).toMatchObject({ label: "self_reported", agent: { id: agentId } });
    const duplicate = await call(`/communities/${slug}/courses/${course.id}/submissions`, {
      method: "POST",
      token: agentToken,
      body: result,
    });
    expect(duplicate.status).toBe(409);
    const summary = await json<{ data: { submissions: number }[] }>(
      await call(`/communities/${slug}/courses/${course.id}/submissions/summary`, {
        cookie: owner.cookie,
      }),
      200,
    );
    expect(summary.data).toEqual([expect.objectContaining({ submissions: 1 })]);

    await json(
      await call(`/communities/${slug}/delegations/${delegation.id}/revoke`, {
        method: "POST",
        cookie: member.cookie,
      }),
      200,
    );
    const after = await call(`/communities/${slug}/courses/${course.slug}`, {
      token: agentToken,
    });
    expect(after.status).toBe(403);
    expect(await after.json()).toMatchObject({ error: { details: { reason: "revoked" } } });

    const actions = await runInCommunity(
      withCommunity(db, parseCommunityId(communityId)),
      ({ tx, where }) =>
        tx.select({ action: auditLog.action }).from(auditLog).where(where(auditLog)),
    );
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "course.agent_access_updated",
        "delegation.created",
        "submission.created",
        "delegation.revoked",
      ]),
    );
  });

  it("turns an agent's checkout into a purchase request that never charges by itself", async () => {
    payments.createCheckoutSession.mockReset();
    payments.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/s/1" });
    const proposed = await json<{ status: string; approvalId: string }>(
      await call(`/communities/${communityId}/payments/checkout`, {
        method: "POST",
        token: agentToken,
        body: { interval: "month" },
      }),
      202,
    );
    expect(proposed.status).toBe("pending_approval");
    expect(payments.createCheckoutSession).not.toHaveBeenCalled();

    const ownerQueue = await json<{ data: { id: string }[] }>(
      await call(`/communities/${slug}/manage/approvals`, { cookie: owner.cookie }),
      200,
    );
    expect(ownerQueue.data.map((row) => row.id)).not.toContain(proposed.approvalId);
    const ownerApprove = await call(
      `/communities/${slug}/manage/approvals/${proposed.approvalId}/approve`,
      { method: "POST", cookie: owner.cookie },
    );
    expect(ownerApprove.status).toBe(404);

    const mine = await json<{ data: { id: string; category: string }[] }>(
      await call(`/communities/${slug}/purchase-requests`, { cookie: member.cookie }),
      200,
    );
    expect(mine.data).toEqual([
      expect.objectContaining({ id: proposed.approvalId, category: "purchase" }),
    ]);

    const decision = await json<{
      approval: { state: string; result: Record<string, unknown> };
      checkoutUrl: string;
    }>(
      await call(`/communities/${slug}/purchase-requests/${proposed.approvalId}/approve`, {
        method: "POST",
        cookie: member.cookie,
      }),
      200,
    );
    expect(decision.checkoutUrl).toBe("https://checkout.stripe.test/s/1");
    expect(decision.approval.state).toBe("executed");
    expect(JSON.stringify(decision.approval.result)).not.toContain("checkout.stripe.test");
    expect(payments.createCheckoutSession).toHaveBeenCalledOnce();
    const [actor] = payments.createCheckoutSession.mock.calls[0] ?? [];
    expect(actor).toEqual(expect.objectContaining({ kind: "user", userId: member.userId }));
    expect(actor && "credential" in actor ? actor.credential : undefined).toBeUndefined();

    const agentView = await json<{ state: string; result: Record<string, unknown> }>(
      await call(`/communities/${slug}/approvals/${proposed.approvalId}`, { token: agentToken }),
      200,
    );
    expect(agentView.state).toBe("executed");
    expect(JSON.stringify(agentView.result)).not.toContain("https://");
  });

  it("lets the agent of a person whose membership ended propose the purchase, and only the person pays and delegates again", async () => {
    const lia = await signUp("Lia Lapsed");
    const community = withCommunity(db, parseCommunityId(communityId));
    await addMembership(community, { userId: lia.userId, role: "member", status: "active" });
    const liaAgent = (
      await json<{ id: string }>(
        await call(`/communities/${slug}/agents`, {
          method: "POST",
          cookie: lia.cookie,
          body: { name: "Lia's agent", scopes: ["courses:read", "proposals:write"] },
        }),
        201,
      )
    ).id;
    const token = (
      await json<{ token: string }>(
        await call(`/communities/${slug}/agents/${liaAgent}/tokens`, {
          method: "POST",
          cookie: lia.cookie,
          body: { name: "Key" },
        }),
        201,
      )
    ).token;
    await json(
      await call(`/communities/${slug}/courses/${course.id}/agent-access`, {
        method: "PUT",
        cookie: owner.cookie,
        body: { allowAgentAccess: true, licenseId: "personal_agents" },
      }),
      200,
    );
    await setMembershipStatus(community, lia.userId, "removed");
    payments.createCheckoutSession.mockReset();
    payments.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/s/lia" });

    for (const path of [
      `/communities/${slug}/agent-courses`,
      `/communities/${slug}/courses/${course.id}/agent-material`,
      `/communities/${slug}/courses/${course.slug}`,
    ]) {
      const refused = await call(path, { token });
      expect(refused.status, path).toBe(403);
      expect(await refused.json(), path).toMatchObject({ error: { code: "membership_required" } });
    }

    const proposed = await json<{ status: string; approvalId: string }>(
      await call(`/communities/${communityId}/payments/checkout`, {
        method: "POST",
        token,
        body: { interval: "month" },
      }),
      202,
    );
    expect(proposed.status).toBe("pending_approval");
    const selfApprove = await call(
      `/communities/${slug}/purchase-requests/${proposed.approvalId}/approve`,
      { method: "POST", token },
    );
    expect(selfApprove.status).toBe(403);
    expect(payments.createCheckoutSession).not.toHaveBeenCalled();
    const status = await json<{ state: string }>(
      await call(`/communities/${slug}/approvals/${proposed.approvalId}`, { token }),
      200,
    );
    expect(status.state).toBe("pending");

    const requests = await json<{ data: { id: string }[] }>(
      await call(`/communities/${slug}/purchase-requests`, { cookie: lia.cookie }),
      200,
    );
    expect(requests.data.map((row) => row.id)).toEqual([proposed.approvalId]);
    const decision = await json<{ checkoutUrl: string; approval: { state: string } }>(
      await call(`/communities/${slug}/purchase-requests/${proposed.approvalId}/approve`, {
        method: "POST",
        cookie: lia.cookie,
      }),
      200,
    );
    expect(decision.checkoutUrl).toBe("https://checkout.stripe.test/s/lia");
    expect(payments.createCheckoutSession).toHaveBeenCalledOnce();
    const [buyer] = payments.createCheckoutSession.mock.calls[0] ?? [];
    expect(buyer).toEqual({ kind: "user", userId: lia.userId, platformAdmin: false });

    await setMembershipStatus(community, lia.userId, "active");
    const before = await call(`/communities/${slug}/courses/${course.id}/agent-material`, {
      token,
    });
    expect(before.status).toBe(403);
    await json(
      await call(`/communities/${slug}/delegations`, {
        method: "POST",
        cookie: lia.cookie,
        body: { courseId: course.id, agentId: liaAgent },
      }),
      201,
    );
    const listed = await json<{ data: { id: string }[] }>(
      await call(`/communities/${slug}/agent-courses`, { token }),
      200,
    );
    expect(listed.data.map((row) => row.id)).toEqual([course.id]);
  });
});
