import { InvalidTokenError, invalidTokenReasons } from "@cohory/agents";
import { scopes, type ApiCredential, type Scope } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import { routeScopes, type OperationId } from "../route-meta";
import { createAgentsStub } from "../test/agents-stub";
import { approvalView, createApprovalsStub } from "../test/approvals-stub";

const token = `cohory_${"a".repeat(43)}`;
const slug = "scoped";
let communityId = "";
let ownerId = "";
let credential: ApiCredential;
let api: ReturnType<typeof createApi>;
const agents = createAgentsStub();
const { authenticate, recordApiWrite } = agents;
const approvals = createApprovalsStub();

const document = (await (
  await createApi(() =>
    apiDeps({
      resolveSession: async () => null,
      communities: createCommunitiesService(createFakeRepository()),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (i) => ({ key: i.key, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
    }),
  ).request("/api/openapi.json")
).json()) as {
  paths: Record<string, Record<string, { operationId: OperationId }>>;
};

const routeOf = new Map<OperationId, { method: string; path: string }>(
  Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => [op.operationId, { method, path }] as const),
  ),
);

function requestFor(id: OperationId): { method: string; path: string } {
  const route = routeOf.get(id);
  if (!route) throw new Error(`no route for ${id}`);
  return {
    method: route.method.toUpperCase(),
    path: route.path
      .replace("{slug}", slug)
      .replace("{communityId}", communityId)
      .replace(/\{[A-Za-z]+\}/g, newId()),
  };
}

function send(id: OperationId, headers: Record<string, string> = {}): Promise<Response> {
  const { method, path } = requestFor(id);
  return Promise.resolve(
    api.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      ...(method === "GET" ? {} : { body: "{}" }),
    }),
  );
}

function grant(type: ApiCredential["type"], granted: readonly Scope[]): void {
  credential = {
    type,
    tokenId: newId(),
    agentId: type === "agent" ? newId() : null,
    communityId,
    scopes: granted,
    via: "api",
  };
  authenticate.mockImplementation(async () => ({
    userId: ownerId,
    communitySlug: slug,
    role: "owner",
    standing: "member",
    credential,
    oauthGrantId: null,
  }));
}

beforeEach(() => {
  approvals.propose.mockReset();
  approvals.propose.mockImplementation(async () => approvalView());
  recordApiWrite.mockReset();
  authenticate.mockReset();
  const communitiesRepo = createFakeRepository();
  const postsRepo = createFakePostsRepository();
  const community = communitiesRepo.addCommunity({ slug: communitySlugSchema.parse(slug) });
  communityId = community.id;
  ownerId = newId();
  communitiesRepo.addMembership({ communityId, userId: ownerId, role: "owner" });
  postsRepo.addCommunity(communityId);
  postsRepo.addMember(communityId, ownerId, "owner");
  postsRepo.addUser(ownerId, "Owner");
  api = createApi(() =>
    apiDeps({
      resolveSession: async () => ({ userId: ownerId }),
      communities: createCommunitiesService(communitiesRepo),
      posts: createPostsService({
        repo: postsRepo,
        storage: {
          put: async (i) => ({ key: i.key, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      agents,
      approvals,
      rateLimiter: createRateLimiter({ rules: rateLimitDefaults }),
    }),
  );
});

const tokenRoutes = (
  Object.entries(routeScopes) as [OperationId, (typeof routeScopes)[OperationId]][]
).filter(([, meta]) => meta.scope !== null);

describe("scope enforcement per scope", () => {
  it.each(scopes.filter((scope) => tokenRoutes.some(([, meta]) => meta.scope === scope)))(
    "refuses a route that needs %s to a token without it and lets it through with it",
    async (scope) => {
      const [id] =
        tokenRoutes.find(
          ([, meta]) => meta.scope === scope && !meta.action?.startsWith("membership.ban"),
        ) ?? [];
      if (!id) throw new Error("no route");
      grant(
        "user",
        scopes.filter((other) => other !== scope),
      );

      const refused = await send(id);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "insufficient_scope", details: { required: scope } },
      });

      grant("user", [scope]);
      const passed = await send(id);
      const body = (await passed.json().catch(() => ({}))) as { error?: { code?: string } };
      expect(body.error?.code).not.toBe("insufficient_scope");
      expect(body.error?.code).not.toBe("token_not_allowed");
    },
  );
});

describe("session only routes", () => {
  it.each(
    (Object.entries(routeScopes) as [OperationId, (typeof routeScopes)[OperationId]][])
      .filter(([id, meta]) => meta.scope === null && id !== "getHealth")
      .map(([id]) => id),
  )("refuses %s to a token holding every scope", async (id) => {
    grant("user", scopes);

    const response = await send(id);

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toMatch(
      /^(token_not_allowed|approval_required)$/,
    );
  });
});

const approvalRoutes = tokenRoutes
  .filter(([, meta]) =>
    [
      "post.delete",
      "comment.delete",
      "membership.remove",
      "membership.ban",
      "membership.change_role",
      "course.delete",
      "course.publish",
      "lesson.delete",
      "event.delete",
    ].includes(meta.action ?? ""),
  )
  .map(([id]) => id);

describe("agents", () => {
  it.each(approvalRoutes)(
    "refuses %s without proposals:write even with every other scope",
    async (id) => {
      grant(
        "agent",
        scopes.filter((scope) => scope !== "proposals:write"),
      );

      const response = await send(id);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "approval_required", details: { required: "proposals:write" } },
      });
      expect(approvals.propose).not.toHaveBeenCalled();
      expect(recordApiWrite).not.toHaveBeenCalled();
    },
  );

  it.each(approvalRoutes.filter((id) => !["changeMemberRole", "banReportedAuthor"].includes(id)))(
    "turns %s into a pending approval request with proposals:write and the route scope",
    async (id) => {
      grant("agent", ["proposals:write", routeScopes[id].scope ?? "proposals:write"]);

      const response = await send(id);

      expect(response.status).toBe(202);
      const body = (await response.json()) as { status: string; approvalId: string };
      expect(body.status).toBe("pending_approval");
      expect(response.headers.get("location")).toContain(`/approvals/${body.approvalId}`);
      expect(approvals.propose).toHaveBeenCalledOnce();
      const [passed, owner, proposal] = approvals.propose.mock.calls[0] ?? [];
      expect(passed).toEqual(credential);
      expect(owner).toBe(ownerId);
      expect(proposal).toMatchObject({ operationId: id, method: requestFor(id).method });
      expect(recordApiWrite).not.toHaveBeenCalled();
    },
  );

  it.each(approvalRoutes.filter((id) => routeScopes[id].scope !== null))(
    "refuses to let %s be proposed without the route scope",
    async (id) => {
      grant("agent", ["proposals:write"]);

      const response = await send(id);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "insufficient_scope", details: { required: routeScopes[id].scope } },
      });
      expect(approvals.propose).not.toHaveBeenCalled();
    },
  );

  it("records the validated input and refuses an invalid one without a request", async () => {
    grant("agent", ["proposals:write", "members:moderate"]);
    const userId = newId();
    const path = `/api/v1/communities/${slug}/manage/people/${userId}/role`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const invalid = await api.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role: "owner" }),
    });
    expect(invalid.status).toBe(422);
    expect(approvals.propose).not.toHaveBeenCalled();

    const valid = await api.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role: "moderator" }),
    });
    expect(valid.status).toBe(202);
    expect(approvals.propose.mock.calls[0]?.[2]).toMatchObject({
      operationId: "changeMemberRole",
      category: "role",
      path,
      input: { params: { slug, userId }, query: {}, body: { role: "moderator" } },
    });
  });

  it.each([
    "archiveCommunity",
    "unarchiveCommunity",
    "deleteCommunity",
    "transferOwnership",
  ] as const)("refuses %s to an agent with every scope and stores no request", async (id) => {
    grant("agent", scopes);

    const response = await send(id);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "not_allowed_for_agents" } });
    expect(approvals.propose).not.toHaveBeenCalled();
    expect(recordApiWrite).not.toHaveBeenCalled();
  });

  it("does not offer approval for reads such as webhook endpoints", async () => {
    grant("agent", scopes);

    const response = await send("listWebhookEndpoints");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "approval_required", details: { proposable: false } },
    });
    expect(approvals.propose).not.toHaveBeenCalled();
  });

  it("turns a scheduled post from an agent into an approval request", async () => {
    grant("agent", ["posts:write", "proposals:write"]);

    const response = await api.request(`/api/v1/communities/${slug}/posts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Monday call",
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
        },
        scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    expect(response.status).toBe(202);
    expect(approvals.propose.mock.calls[0]?.[2]).toMatchObject({
      operationId: "createPost",
      category: "publishing",
      summary: expect.stringContaining('schedule the post "Monday call"'),
    });
  });

  it("passes the agent identity to the service and records the write", async () => {
    grant("agent", ["posts:write"]);

    const response = await api.request(`/api/v1/communities/${slug}/posts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "draft",
      agent: { id: credential.agentId },
    });
    expect(recordApiWrite).toHaveBeenCalledWith(credential, ownerId, {
      operationId: "createPost",
      method: "POST",
      path: `/api/v1/communities/${slug}/posts`,
      status: 201,
    });
  });

  it("does not record reads", async () => {
    grant("agent", ["posts:read"]);

    expect((await send("listPosts")).status).toBe(200);
    expect(recordApiWrite).not.toHaveBeenCalled();
  });

  it("caps agent writes per hour", async () => {
    grant("agent", ["posts:write"]);
    const writeLimiter = createRateLimiter({
      rules: { ...rateLimitDefaults, agentWrite: { max: 1, windowSeconds: 3600 } },
    });
    const limited = createApi(() =>
      apiDeps({
        resolveSession: async () => null,
        communities: createCommunitiesService(createFakeRepository()),
        posts: createPostsService({
          repo: createFakePostsRepository(),
          storage: {
            put: async (i) => ({ key: i.key, contentType: "image/png", size: 0 }),
            publicUrl: (k) => k,
          },
        }),
        agents,
        rateLimiter: writeLimiter,
      }),
    );
    const like = () =>
      limited.request(`/api/v1/communities/${slug}/posts/${newId()}/like`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await like()).status).not.toBe(429);
    const refused = await like();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("3600");
    expect(refused.headers.get("ratelimit-limit")).toBe("1");
  });
});

describe("invalid tokens", () => {
  it.each(invalidTokenReasons)(
    "answers 401 with a plain message when the token is %s",
    async (reason) => {
      authenticate.mockRejectedValue(new InvalidTokenError(reason));

      const response = await send("listPosts");

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invalid_token");
      expect(body.error.message).toMatch(/\.$/);
      expect(body.error.message).not.toContain(token);
    },
  );

  it("refuses a non bearer authorization header without calling the database", async () => {
    const response = await api.request(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: "Token abc" },
    });

    expect(response.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
