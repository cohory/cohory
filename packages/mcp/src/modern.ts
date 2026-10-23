import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { isJsonObject, type JsonObject } from "./json-schema";

export const modernProtocolVersions: readonly string[] = ["2026-07-28"];
export const legacyProtocolVersions: readonly string[] = [...SUPPORTED_PROTOCOL_VERSIONS];
export const supportedProtocolVersions: readonly string[] = [
  ...modernProtocolVersions,
  ...legacyProtocolVersions,
];

export const protocolVersionKey = "io.modelcontextprotocol/protocolVersion";
export const serverInfoKey = "io.modelcontextprotocol/serverInfo";

export const headerMismatchCode = -32020;
export const unsupportedProtocolVersionCode = -32022;

export type Era =
  | { readonly kind: "legacy" }
  | { readonly kind: "modern"; readonly version: string }
  | { readonly kind: "unsupported"; readonly requested: string };

export interface ModernOperations {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly instructions: string;
  readonly listTools: () => Tool[];
  readonly callTool: (name: string, args: JsonObject) => Promise<CallToolResult>;
}

function metaVersion(message: unknown): string | null {
  if (!isJsonObject(message) || !isJsonObject(message.params)) return null;
  const meta = message.params._meta;
  if (!isJsonObject(meta)) return null;
  const version = meta[protocolVersionKey];
  return typeof version === "string" ? version : null;
}

export function eraOf(headers: Headers, message: unknown): Era {
  if (isJsonObject(message) && message.method === "initialize") return { kind: "legacy" };
  const requested = headers.get("mcp-protocol-version") ?? metaVersion(message);
  if (requested === null || legacyProtocolVersions.includes(requested)) return { kind: "legacy" };
  if (modernProtocolVersions.includes(requested)) return { kind: "modern", version: requested };
  return { kind: "unsupported", requested };
}

function rpcResponse(status: number, body: JsonObject, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", ...body }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function rpcError(
  status: number,
  id: unknown,
  code: number,
  message: string,
  data: unknown = null,
  headers: Record<string, string> = {},
): Response {
  const error: JsonObject = data === null ? { code, message } : { code, message, data };
  const requestId = typeof id === "string" || typeof id === "number" ? id : null;
  return rpcResponse(status, { id: requestId, error }, headers);
}

export function unsupportedVersion(id: unknown, requested: string): Response {
  return rpcError(400, id, unsupportedProtocolVersionCode, "Unsupported protocol version", {
    supported: supportedProtocolVersions,
    requested,
  });
}

function decodeHeader(value: string | null): string | null {
  if (value === null) return null;
  const encoded = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value)?.[1];
  return encoded === undefined ? value : Buffer.from(encoded, "base64").toString("utf8");
}

function mismatch(id: unknown, detail: string): Response {
  return rpcError(400, id, headerMismatchCode, `Header mismatch: ${detail}`);
}

export async function handleModern(
  message: unknown,
  headers: Headers,
  era: { readonly version: string },
  ops: ModernOperations,
): Promise<Response> {
  if (!isJsonObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(400, null, ErrorCode.InvalidRequest, "Send one JSON-RPC request per POST.");
  }
  const { id, method } = message;
  if (id === undefined) {
    return new Response(null, { status: 202 });
  }
  const headerVersion = headers.get("mcp-protocol-version");
  if (headerVersion === null || metaVersion(message) !== headerVersion) {
    return mismatch(id, `MCP-Protocol-Version must match _meta ${protocolVersionKey}`);
  }
  if (headers.get("mcp-method") !== method) {
    return mismatch(id, "Mcp-Method must match the request method");
  }
  const meta = { [serverInfoKey]: ops.serverInfo };
  const complete = (result: JsonObject) =>
    rpcResponse(200, { id, result: { resultType: "complete", ...result, _meta: meta } }, {});

  if (method === "server/discover") {
    return complete({
      supportedVersions: [...supportedProtocolVersions],
      capabilities: { tools: {} },
      instructions: ops.instructions,
      ttlMs: 3_600_000,
      cacheScope: "public",
    });
  }
  if (method === "tools/list") {
    return complete({ tools: ops.listTools(), ttlMs: 60_000, cacheScope: "private" });
  }
  if (method === "tools/call") {
    const parsed = CallToolRequestSchema.safeParse(message);
    if (!parsed.success) {
      return rpcError(200, id, ErrorCode.InvalidParams, "tools/call needs a tool name.");
    }
    if (decodeHeader(headers.get("mcp-name")) !== parsed.data.params.name) {
      return mismatch(id, "Mcp-Name must match params.name");
    }
    const args = parsed.data.params.arguments ?? {};
    try {
      return complete({ ...(await ops.callTool(parsed.data.params.name, args)) });
    } catch (error: unknown) {
      if (error instanceof McpError) {
        return rpcError(200, id, error.code, error.message, error.data ?? null);
      }
      throw error;
    }
  }
  return rpcError(404, id, ErrorCode.MethodNotFound, `Method not found: ${method}`);
}
