import {
  agentForbiddenActions,
  approvalActions,
  ApprovalRequiredError,
  nonGrantableActions,
  proposalScope,
  scopeDetails,
  type ApiCredential,
  type ApprovalCategory,
  type PolicyAction,
} from "@cohory/authz";
import type { AgentsService, AuthenticatedToken, InvalidTokenReason } from "@cohory/agents";
import { InvalidTokenError } from "@cohory/agents";
import { runWithAuditSource } from "@cohory/db";
import type { RateLimiter, RateLimitTake } from "@cohory/rate-limit";
import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";

import {
  proposability,
  type ApprovalGateway,
  type RouteRequestSchemas,
} from "../approvals/gateway";
import { agentNotAllowedMessage, errorJson, type ApiError } from "../errors";
import type { CohoryRouteExtension } from "../route-meta";
import type { ActorVariables } from "./session";

export interface TokenAuthDeps {
  readonly agents: Pick<AgentsService, "authenticate" | "recordApiWrite">;
  readonly rateLimiter: RateLimiter;
}

export interface RouteEntry {
  readonly meta: CohoryRouteExtension;
  readonly request: RouteRequestSchemas | null;
}

export interface MatchedRoute extends RouteEntry {
  readonly params: Readonly<Record<string, string>>;
}

export type RouteLookup = (method: string, honoPath: string) => RouteEntry | null;

export type TokenDecision =
  | { readonly kind: "pass" }
  | { readonly kind: "refuse"; readonly error: Omit<ApiError, "status"> }
  | { readonly kind: "propose"; readonly category: ApprovalCategory };

const invalidTokenMessages: Record<InvalidTokenReason, string> = {
  malformed: "This API token is not valid. Check that you copied all of it, or create a new one.",
  unknown: "This API token is not valid. Check that you copied all of it, or create a new one.",
  revoked: "This API token was revoked. Create a new one to continue.",
  expired: "This API token has expired. Create a new one to continue.",
  agent_suspended:
    "This agent is paused. Its owner can turn it back on in Manage, Settings, Agents.",
  agent_revoked: "This agent was revoked. Its tokens no longer work.",
  membership_required: "The person who owns this token is no longer a member of the community.",
};

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const lapsedOperations: ReadonlySet<string> = new Set([
  "createMembershipCheckout",
  "getApprovalRequest",
  "listApprovalRequests",
]);

export const lapsedMessage =
  "The person who owns this token is no longer a member of the community. This agent can only ask them to buy the membership (propose_course_purchase) and check its approval requests.";

export interface McpCaller {
  readonly raw: string;
  readonly authenticated: AuthenticatedToken;
}

export type McpBindings = Readonly<Record<never, never>>;

const mcpCallers = new WeakMap<object, McpCaller>();

export function mcpBindingsFor(caller: McpCaller): McpBindings {
  const bindings = Object.freeze({});
  mcpCallers.set(bindings, caller);
  return bindings;
}

function mcpCallerOf(env: unknown): McpCaller | null {
  return env !== null && typeof env === "object" ? (mcpCallers.get(env) ?? null) : null;
}

function wrongResource(c: Context): Response {
  c.header(
    "WWW-Authenticate",
    `Bearer error="invalid_token", error_description="This token was issued for the MCP server at /mcp"`,
  );
  return errorJson(c, {
    status: 401,
    code: "invalid_token",
    message:
      "This token was issued to an app connected through MCP and works only at /mcp. Create an agent token for the API.",
    details: { reason: "wrong_resource" },
  });
}

function invalidToken(c: Context, reason: InvalidTokenReason): Response {
  c.header("WWW-Authenticate", `Bearer error="invalid_token"`);
  return errorJson(c, {
    status: 401,
    code: "invalid_token",
    message: invalidTokenMessages[reason],
    details: { reason },
  });
}

function forbidden(c: Context, error: Omit<ApiError, "status">): Response {
  return errorJson(c, { status: 403, ...error });
}

function rateHeaders(c: Context, take: RateLimitTake): void {
  c.header("RateLimit-Limit", String(take.limit));
  c.header("RateLimit-Remaining", String(take.remaining));
  c.header("RateLimit-Reset", String(take.resetSeconds));
}

function limited(c: Context, take: RateLimitTake): Response {
  return errorJson(c, {
    status: 429,
    code: "rate_limited",
    message: "Too many requests from this token. Wait a moment and try again.",
    retryAfterSeconds: take.retryAfterSeconds,
  });
}

function paramsOf(pattern: string, path: string): Record<string, string> {
  const names = pattern.split("/");
  const values = path.split("/");
  const params: Record<string, string> = {};
  names.forEach((segment, index) => {
    const match = /^:([A-Za-z0-9_]+)/.exec(segment);
    const value = values[index];
    if (match?.[1] && value !== undefined) {
      params[match[1]] = decodeURIComponent(value);
    }
  });
  return params;
}

function matchRoute(c: Context, lookup: RouteLookup): MatchedRoute | null {
  const method = c.req.method === "HEAD" ? "GET" : c.req.method;
  for (const route of matchedRoutes(c)) {
    if (route.method !== method) {
      continue;
    }
    const entry = lookup(method, route.path);
    if (entry) {
      return { ...entry, params: paramsOf(route.path, c.req.path) };
    }
  }
  return null;
}

function inTokenCommunity(
  credential: ApiCredential,
  communitySlug: string,
  params: Readonly<Record<string, string>>,
): boolean {
  if (params.communityId !== undefined && params.communityId !== credential.communityId) {
    return false;
  }
  if (params.slug !== undefined && params.slug.toLowerCase() !== communitySlug.toLowerCase()) {
    return false;
  }
  return true;
}

function proposalProblem(
  credential: ApiCredential,
  route: Pick<MatchedRoute, "meta" | "request">,
  method: string,
  action: PolicyAction,
  category: ApprovalCategory,
): Omit<ApiError, "status"> | null {
  const proposable = proposability(route.meta, method, route.request);
  if (proposable.kind === "refused") {
    return {
      code: "approval_required",
      message: proposable.message,
      details: { action, category, proposable: false },
    };
  }
  if (!credential.scopes.includes("proposals:write")) {
    return {
      code: "approval_required",
      message:
        'An agent cannot do this on its own. Give it the "Propose changes" permission (proposals:write) so it can ask a person to approve it.',
      details: { action, category, required: "proposals:write" },
    };
  }
  const required = proposalScope(action, route.meta.scope);
  if (required !== null && !credential.scopes.includes(required)) {
    return {
      code: "insufficient_scope",
      message: `This agent is missing the "${scopeDetails[required].label}" permission (${required}), so it cannot ask for this either.`,
      details: { required, action, category },
    };
  }
  return null;
}

export function tokenDecision(
  credential: ApiCredential,
  route: Pick<RouteEntry, "meta" | "request">,
  method: string,
): TokenDecision {
  const { meta } = route;
  if (meta.action && credential.type === "agent" && agentForbiddenActions.has(meta.action)) {
    return {
      kind: "refuse",
      error: {
        code: "not_allowed_for_agents",
        message: agentNotAllowedMessage,
        details: { action: meta.action, proposable: false },
      },
    };
  }
  if (meta.action && credential.type === "agent") {
    const category = approvalActions[meta.action];
    if (category) {
      const problem = proposalProblem(credential, route, method, meta.action, category);
      return problem ? { kind: "refuse", error: problem } : { kind: "propose", category };
    }
  }
  if (meta.scope === null || (meta.action && nonGrantableActions.has(meta.action))) {
    return {
      kind: "refuse",
      error: {
        code: "token_not_allowed",
        message: "API tokens cannot do this. Sign in to Cohory to do it yourself.",
        details: { operationId: meta.operationId },
      },
    };
  }
  if (!credential.scopes.includes(meta.scope)) {
    return {
      kind: "refuse",
      error: {
        code: "insufficient_scope",
        message: `This token is missing the "${scopeDetails[meta.scope].label}" permission (${meta.scope}).`,
        details: { required: meta.scope },
      },
    };
  }
  return { kind: "pass" };
}

export function bearerAuth(
  getDeps: () => TokenAuthDeps,
  lookup: RouteLookup,
  gateway: () => ApprovalGateway,
): MiddlewareHandler<{ Variables: ActorVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (header === undefined) {
      await next();
      return;
    }
    const raw = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
    if (!raw) {
      return invalidToken(c, "malformed");
    }
    const deps = getDeps();
    const fromMcp = mcpCallerOf(c.env);
    let authenticated: AuthenticatedToken;
    if (fromMcp?.raw === raw) {
      authenticated = fromMcp.authenticated;
    } else {
      try {
        authenticated = await deps.agents.authenticate(raw);
      } catch (error: unknown) {
        if (error instanceof InvalidTokenError) {
          return invalidToken(c, error.reason);
        }
        throw error;
      }
    }
    if (authenticated.oauthGrantId !== null && fromMcp === null) {
      return wrongResource(c);
    }
    const { userId, communitySlug, standing } = authenticated;
    const credential: ApiCredential = {
      ...authenticated.credential,
      via: fromMcp === null ? "api" : "mcp",
    };
    const write = !readMethods.has(c.req.method);
    const requests =
      credential.type === "agent"
        ? deps.rateLimiter.take("agentRequest", `agent:${credential.agentId}`)
        : deps.rateLimiter.take("apiToken", `token:${credential.tokenId}`);
    rateHeaders(c, requests);
    if (!requests.allowed) {
      return limited(c, requests);
    }

    const matched = matchRoute(c, lookup);
    if (!matched) {
      if (standing === "lapsed") {
        return forbidden(c, { code: "membership_required", message: lapsedMessage });
      }
      c.set("actor", { kind: "guest" });
      await next();
      return;
    }
    if (standing === "lapsed" && !lapsedOperations.has(matched.meta.operationId)) {
      return forbidden(c, { code: "membership_required", message: lapsedMessage });
    }
    const method = c.req.method === "HEAD" ? "GET" : c.req.method;
    const decision = tokenDecision(credential, matched, method);
    if (decision.kind === "refuse") {
      return forbidden(c, decision.error);
    }
    if (!inTokenCommunity(credential, communitySlug, matched.params)) {
      return forbidden(c, {
        code: "wrong_community",
        message: "This token belongs to a different community.",
      });
    }
    if (write && credential.type === "agent") {
      const writes = deps.rateLimiter.take("agentWrite", `agent:${credential.agentId}`);
      if (!writes.allowed) {
        rateHeaders(c, writes);
        return limited(c, writes);
      }
    }

    c.set("actor", { kind: "user", userId, platformAdmin: false, credential });
    const proposal = (category: ApprovalCategory) =>
      gateway().propose(c, {
        meta: matched.meta,
        request: matched.request,
        params: matched.params,
        credential,
        userId,
        communitySlug,
        category,
      });
    return runWithAuditSource(
      {
        actorType: credential.type === "agent" ? "agent" : "user",
        via: credential.via,
        tokenId: credential.tokenId,
        agentId: credential.agentId,
      },
      async (): Promise<Response | undefined> => {
        if (decision.kind === "propose") {
          return proposal(decision.category);
        }
        await next();
        const refused = c.error;
        if (
          credential.type === "agent" &&
          refused instanceof ApprovalRequiredError &&
          credential.scopes.includes("proposals:write") &&
          proposability(matched.meta, method, matched.request).kind === "proposable"
        ) {
          c.res = await proposal(refused.category);
          return undefined;
        }
        if (write && c.res.status < 400) {
          await deps.agents.recordApiWrite(credential, userId, {
            operationId: matched.meta.operationId,
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
          });
        }
        return undefined;
      },
    );
  };
}

export function sessionAuditSource(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("authorization") !== undefined) {
      await next();
      return;
    }
    await runWithAuditSource({ actorType: "user", via: "web", tokenId: null, agentId: null }, () =>
      next(),
    );
  };
}
