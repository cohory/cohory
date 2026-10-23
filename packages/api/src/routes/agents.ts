import { createRoute, z } from "@hono/zod-openapi";
import {
  maxTokenDays,
  type AgentsService,
  type AgentView,
  type ApiTokenView,
  type PersonalTokenView,
} from "@cohory/agents";
import { scopes, type Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { errorResponse, json, slugParams } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface AgentsRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  agents: AgentsService;
}

const security = [{ sessionCookie: [] }];
const sessionOnly =
  " Needs a signed in session: API tokens cannot list, create, or revoke tokens or agents.";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this."),
  404: errorResponse("The community, agent, or token does not exist or is not visible."),
  422: errorResponse("The input is invalid."),
};

const scopeSchema = z.enum(scopes).openapi("ApiScope");
const tokenStateSchema = z.enum(["active", "expired", "revoked"]);

const tokenSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["personal", "agent"]),
    communityId: z.uuid(),
    agentId: z.uuid().nullable(),
    name: z.string(),
    prefix: z.string().openapi({ description: "The first 12 characters, to recognize it." }),
    scopes: z.array(scopeSchema),
    state: tokenStateSchema,
    expiresAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ApiToken");

const personalTokenSchema = tokenSchema
  .extend({ community: z.object({ slug: z.string(), name: z.string() }) })
  .openapi("PersonalApiToken");

const createdTokenSchema = z
  .object({
    token: z.string().openapi({
      description: "The secret token. It is shown only in this response; store it now.",
      example: "cohory_...",
    }),
    tokenInfo: tokenSchema,
  })
  .openapi("CreatedApiToken");

const agentSchema = z
  .object({
    id: z.uuid(),
    communityId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    scopes: z.array(scopeSchema),
    status: z.enum(["active", "suspended", "revoked"]),
    communityWide: z.boolean(),
    owner: z.object({ id: z.uuid(), name: z.string() }),
    lastActivityAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    canManage: z.boolean(),
    canIssueTokens: z.boolean().openapi({
      description: "Whether you may issue tokens for this agent. Only the person it acts for may.",
    }),
    tokens: z.array(tokenSchema),
  })
  .openapi("Agent");

const expiresInDays = z
  .number()
  .int()
  .min(1)
  .max(maxTokenDays)
  .optional()
  .openapi({
    description: `Days until the token expires. Default 90, max ${maxTokenDays}.`,
  });

const createTokenBodySchema = z
  .object({
    communityId: z.uuid(),
    name: z.string().max(60),
    scopes: z.array(scopeSchema).min(1),
    expiresInDays,
  })
  .openapi("CreateApiTokenInput");

const createAgentBodySchema = z
  .object({
    name: z.string().max(60),
    description: z.string().max(280).optional(),
    scopes: z.array(scopeSchema).min(1),
    communityWide: z.boolean().optional(),
  })
  .openapi("CreateAgentInput");

const updateAgentBodySchema = z
  .object({
    name: z.string().max(60).optional(),
    description: z.string().max(280).nullable().optional(),
    scopes: z.array(scopeSchema).min(1).optional(),
    communityWide: z.boolean().optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .openapi("UpdateAgentInput");

const issueTokenBodySchema = z
  .object({ name: z.string().max(60), expiresInDays })
  .openapi("CreateAgentTokenInput");

const tokenParams = z.object({
  tokenId: z.uuid().openapi({ param: { name: "tokenId", in: "path" } }),
});
const agentParams = slugParams.extend({
  agentId: z.uuid().openapi({ param: { name: "agentId", in: "path" } }),
});
const agentTokenParams = agentParams.extend({
  tokenId: z.uuid().openapi({ param: { name: "tokenId", in: "path" } }),
});

function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function tokenJson(token: ApiTokenView): z.infer<typeof tokenSchema> {
  return {
    ...token,
    scopes: [...token.scopes],
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: iso(token.lastUsedAt),
    revokedAt: iso(token.revokedAt),
    createdAt: token.createdAt.toISOString(),
  };
}

function personalTokenJson(token: PersonalTokenView): z.infer<typeof personalTokenSchema> {
  return { ...tokenJson(token), community: token.community };
}

function agentJson(agent: AgentView): z.infer<typeof agentSchema> {
  return {
    ...agent,
    scopes: [...agent.scopes],
    lastActivityAt: iso(agent.lastActivityAt),
    createdAt: agent.createdAt.toISOString(),
    tokens: agent.tokens.map(tokenJson),
  };
}

const listMyApiTokens = createRoute({
  method: "get",
  path: "/me/api-tokens",
  operationId: "listMyApiTokens",
  "x-cohory": routeMeta("listMyApiTokens"),
  tags: ["API tokens"],
  security,
  summary: "List your personal API tokens",
  description: `Every personal token you created, in every community, newest first. Secrets are never returned.${sessionOnly}`,
  responses: {
    200: json(z.object({ data: z.array(personalTokenSchema), ...pageCursor }), "Your tokens."),
    401: errors[401],
    403: errors[403],
  },
});

const createMyApiToken = createRoute({
  method: "post",
  path: "/me/api-tokens",
  operationId: "createMyApiToken",
  "x-cohory": routeMeta("createMyApiToken"),
  tags: ["API tokens"],
  security,
  summary: "Create a personal API token",
  description: `Creates a token for one community with the scopes you choose. The token acts as you, so it can never do more than your role allows. The secret is in this response only.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: jsonBody(createTokenBodySchema),
  responses: { 201: json(createdTokenSchema, "The new token, shown once."), ...errors },
});

const revokeMyApiToken = createRoute({
  method: "delete",
  path: "/me/api-tokens/{tokenId}",
  operationId: "revokeMyApiToken",
  "x-cohory": routeMeta("revokeMyApiToken"),
  tags: ["API tokens"],
  security,
  summary: "Revoke a personal API token",
  description: `The token stops working on its next request.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: tokenParams },
  responses: { 204: { description: "The token is revoked." }, ...errors },
});

const listAgents = createRoute({
  method: "get",
  path: "/communities/{slug}/agents",
  operationId: "listAgents",
  "x-cohory": routeMeta("listAgents"),
  tags: ["Agents"],
  security,
  summary: "List the community's agents",
  description: `Agents with their owner, scopes, status, last activity, and tokens. Admins and the owner.${sessionOnly}`,
  request: { params: slugParams },
  responses: {
    200: json(z.object({ data: z.array(agentSchema), ...pageCursor }), "The agents."),
    ...errors,
  },
});

const createAgent = createRoute({
  method: "post",
  path: "/communities/{slug}/agents",
  operationId: "createAgent",
  "x-cohory": routeMeta("createAgent"),
  tags: ["Agents"],
  security,
  summary: "Create an agent",
  description: `Creates an agent owned by you. Its effective permissions are its scopes intersected with your current role. Admins and the owner.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: slugParams, ...jsonBody(createAgentBodySchema) },
  responses: { 201: json(agentSchema, "The new agent."), ...errors },
});

const updateAgent = createRoute({
  method: "patch",
  path: "/communities/{slug}/agents/{agentId}",
  operationId: "updateAgent",
  "x-cohory": routeMeta("updateAgent"),
  tags: ["Agents"],
  security,
  summary: "Change, pause, or resume an agent",
  description: `Changes take effect on the agent's next request. The owner manages every agent; admins manage their own and community wide agents.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: agentParams, ...jsonBody(updateAgentBodySchema) },
  responses: {
    204: { description: "The agent is updated." },
    409: errorResponse("The agent is revoked (code agent_not_active)."),
    ...errors,
  },
});

const revokeAgent = createRoute({
  method: "delete",
  path: "/communities/{slug}/agents/{agentId}",
  operationId: "revokeAgent",
  "x-cohory": routeMeta("revokeAgent"),
  tags: ["Agents"],
  security,
  summary: "Revoke an agent",
  description: `Revokes the agent and all its tokens. They stop working on the next request. The agent stays in the list and the audit log.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: agentParams },
  responses: { 204: { description: "The agent is revoked." }, ...errors },
});

const createAgentToken = createRoute({
  method: "post",
  path: "/communities/{slug}/agents/{agentId}/tokens",
  operationId: "createAgentToken",
  "x-cohory": routeMeta("createAgentToken"),
  tags: ["Agents"],
  security,
  summary: "Issue a token for an agent",
  description: `The token carries the agent's current scopes and acts for the agent's owner. The secret is in this response only.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: agentParams, ...jsonBody(issueTokenBodySchema) },
  responses: {
    201: json(createdTokenSchema, "The new token, shown once."),
    409: errorResponse("The agent is paused or revoked (code agent_not_active)."),
    ...errors,
  },
});

const revokeAgentToken = createRoute({
  method: "delete",
  path: "/communities/{slug}/agents/{agentId}/tokens/{tokenId}",
  operationId: "revokeAgentToken",
  "x-cohory": routeMeta("revokeAgentToken"),
  tags: ["Agents"],
  security,
  summary: "Revoke one agent token",
  description: `The token stops working on its next request.${sessionOnly}`,
  middleware: [writeLimit] as const,
  request: { params: agentTokenParams },
  responses: { 204: { description: "The token is revoked." }, ...errors },
});

export function createAgentsRoutes(getDeps: () => AgentsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/me/api-tokens", actor);
  app.use("/me/api-tokens/*", actor);
  app.use("/communities/:slug/agents", actor);
  app.use("/communities/:slug/agents/*", actor);

  const agents = () => getDeps().agents;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listMyApiTokens, async (c) => {
      const tokens = await agents().listPersonalTokens(c.get("actor"));
      return c.json({ data: tokens.map(personalTokenJson), nextCursor: null }, 200);
    })
    .openapi(createMyApiToken, async (c) => {
      const created = await agents().createPersonalToken(c.get("actor"), c.req.valid("json"));
      c.header("Cache-Control", "no-store");
      return c.json({ token: created.token, tokenInfo: tokenJson(created.view) }, 201);
    })
    .openapi(revokeMyApiToken, async (c) => {
      await agents().revokePersonalToken(c.get("actor"), c.req.valid("param").tokenId);
      return c.body(null, 204);
    })
    .openapi(listAgents, async (c) => {
      const caller = c.get("actor");
      const list = await agents().listAgents(
        caller,
        await communityId(caller, c.req.valid("param").slug),
      );
      return c.json({ data: list.map(agentJson), nextCursor: null }, 200);
    })
    .openapi(createAgent, async (c) => {
      const caller = c.get("actor");
      const agent = await agents().createAgent(
        caller,
        await communityId(caller, c.req.valid("param").slug),
        c.req.valid("json"),
      );
      return c.json(agentJson(agent), 201);
    })
    .openapi(updateAgent, async (c) => {
      const caller = c.get("actor");
      const { slug, agentId } = c.req.valid("param");
      await agents().updateAgent(
        caller,
        await communityId(caller, slug),
        agentId,
        c.req.valid("json"),
      );
      return c.body(null, 204);
    })
    .openapi(revokeAgent, async (c) => {
      const caller = c.get("actor");
      const { slug, agentId } = c.req.valid("param");
      await agents().revokeAgent(caller, await communityId(caller, slug), agentId);
      return c.body(null, 204);
    })
    .openapi(createAgentToken, async (c) => {
      const caller = c.get("actor");
      const { slug, agentId } = c.req.valid("param");
      const created = await agents().issueAgentToken(
        caller,
        await communityId(caller, slug),
        agentId,
        c.req.valid("json"),
      );
      c.header("Cache-Control", "no-store");
      return c.json({ token: created.token, tokenInfo: tokenJson(created.view) }, 201);
    })
    .openapi(revokeAgentToken, async (c) => {
      const caller = c.get("actor");
      const { slug, agentId, tokenId } = c.req.valid("param");
      await agents().revokeAgentToken(caller, await communityId(caller, slug), agentId, tokenId);
      return c.body(null, 204);
    });
}
