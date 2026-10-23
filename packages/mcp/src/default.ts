import { getAgentsService } from "@cohory/agents";
import {
  api,
  createOpenApiDocument,
  mcpBindingsFor,
  operationEntries,
  type Api,
} from "@cohory/api";
import { parseAppUrl } from "@cohory/config/platform";
import { getRateLimiter } from "@cohory/rate-limit";
import { logger } from "@cohory/infra/logger";

import { createMcpHandler, type McpLogEntry } from "./handler";
import { buildTools, type McpTool } from "./registry";

export function resourceMetadataUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${parseAppUrl(env)}/.well-known/oauth-protected-resource/mcp`;
}

export function mcpTools(app: Api = api): McpTool[] {
  return buildTools(JSON.parse(JSON.stringify(createOpenApiDocument(app))), operationEntries(app));
}

function logCall(entry: McpLogEntry): void {
  logger.info({ ...entry }, "mcp tool call");
}

let handler: ((request: Request) => Promise<Response>) | undefined;

export function getMcpHandler(): (request: Request) => Promise<Response> {
  if (!handler) {
    let tools: McpTool[] | undefined;
    handler = createMcpHandler({
      fetchApi: async (request, caller) => api.fetch(request, mcpBindingsFor(caller)),
      tools: () => (tools ??= mcpTools(api)),
      authenticate: (raw) => getAgentsService().authenticate(raw, "mcp"),
      rateLimiter: getRateLimiter,
      resourceMetadataUrl: () => resourceMetadataUrl(),
      log: logCall,
    });
  }
  return handler;
}
