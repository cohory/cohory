import type { AuthenticatedToken, TokenStanding } from "@cohory/agents";
import { api } from "@cohory/api";
import type { ApiCredential, CommunityRole, Scope } from "@cohory/authz";
import { createRateLimiter, rateLimitDefaults, type RateLimiter } from "@cohory/rate-limit";

import { mcpTools } from "../default";
import { createMcpHandler, type McpHandlerDeps } from "../handler";

export const tools = mcpTools(api);

export const communityId = "0192f0c0-0000-7000-8000-000000000001";
export const slug = "makers";

export function caller(
  scopes: readonly Scope[],
  options: {
    type?: ApiCredential["type"];
    role?: CommunityRole;
    standing?: TokenStanding;
    oauthGrantId?: string;
  } = {},
): AuthenticatedToken {
  const type = options.type ?? "agent";
  return {
    userId: "0192f0c0-0000-7000-8000-0000000000aa",
    communitySlug: slug,
    role: options.role ?? "owner",
    standing: options.standing ?? "member",
    oauthGrantId: options.oauthGrantId ?? null,
    credential: {
      type,
      tokenId: "0192f0c0-0000-7000-8000-0000000000bb",
      agentId: type === "agent" ? "0192f0c0-0000-7000-8000-0000000000cc" : null,
      communityId,
      scopes,
      via: "api",
    },
  };
}

export interface Harness {
  readonly handle: (request: Request) => Promise<Response>;
  readonly requests: Request[];
}

export function harness(
  who: AuthenticatedToken,
  respond: (request: Request) => Response | Promise<Response>,
  overrides: Partial<McpHandlerDeps> & { limiter?: RateLimiter } = {},
): Harness {
  const requests: Request[] = [];
  const limiter = overrides.limiter ?? createRateLimiter({ rules: rateLimitDefaults });
  const handle = createMcpHandler({
    fetchApi: async (request) => {
      requests.push(request);
      return respond(request);
    },
    tools: () => tools,
    authenticate: async () => who,
    rateLimiter: () => limiter,
    resourceMetadataUrl: () => "https://cohory.test/.well-known/oauth-protected-resource/mcp",
    ...overrides,
  });
  return { handle, requests };
}

let nextId = 1;

export function rpc(
  method: string,
  params: Record<string, unknown> = {},
  init: { token?: string | null; body?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-11-25",
  };
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? "cohory_test"}`;
  return new Request("https://cohory.test/mcp", {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
