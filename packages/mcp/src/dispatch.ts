import { stripInvisibleDeep } from "@cohory/posts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { isJsonObject, type JsonObject } from "./json-schema";
import { untrustedSources, type McpTool } from "./registry";

export interface DispatchTarget {
  readonly origin: string;
  readonly authorization: string;
  readonly communitySlug: string;
  readonly communityId: string;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly maxResultBytes: number;
}

export type DispatchOutcome =
  | { readonly kind: "result"; readonly result: CallToolResult; readonly status: number }
  | {
      readonly kind: "rate_limited";
      readonly message: string;
      readonly retryAfterSeconds: number | null;
    };

export const rateHeaderNames = ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"];

class ToolInputError extends Error {}

function scalar(name: string, value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new ToolInputError(`${name} must be a string, number, or boolean.`);
}

export function buildRequest(
  tool: McpTool,
  args: JsonObject,
  target: Omit<DispatchTarget, "fetch" | "maxResultBytes">,
): Request {
  const { operation } = tool;
  const allowed = new Set(Object.keys(objectProperties(tool)));
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ToolInputError(`Unknown input: ${unknown.join(", ")}.`);
  }
  let path = operation.path;
  for (const name of operation.tokenParams) {
    const value = name === "slug" ? target.communitySlug : target.communityId;
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  for (const name of operation.pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      throw new ToolInputError(`${name} is required.`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(scalar(name, value)));
  }
  const query = new URLSearchParams();
  for (const name of operation.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(name, scalar(name, item));
    }
  }
  let body: string | undefined;
  if (operation.body.kind === "flat") {
    const fields: JsonObject = {};
    for (const name of operation.body.fields) {
      if (args[name] !== undefined) fields[name] = args[name];
    }
    body = JSON.stringify(fields);
  } else if (operation.body.kind === "nested" && args.body !== undefined) {
    body = JSON.stringify(args.body);
  }
  const search = query.size > 0 ? `?${query.toString()}` : "";
  const headers: Record<string, string> = {
    authorization: target.authorization,
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${target.origin}${path}${search}`, {
    method: operation.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function objectProperties(tool: McpTool): JsonObject {
  const properties = tool.inputSchema.properties;
  return isJsonObject(properties) ? properties : {};
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel();
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorParts(body: unknown, status: number) {
  const error = isJsonObject(body) && isJsonObject(body.error) ? body.error : {};
  return {
    code: typeof error.code === "string" ? error.code : `http_${status}`,
    message: typeof error.message === "string" ? error.message : "The request failed.",
    retryAfterSeconds: typeof error.retryAfterSeconds === "number" ? error.retryAfterSeconds : null,
    details: error.details ?? null,
  };
}

export function errorResult(
  code: string,
  message: string,
  details: unknown = null,
): CallToolResult {
  const error = stripInvisibleDeep({ code, message, details });
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ untrusted_content: { ...untrustedSources.community }, error }),
      },
    ],
  };
}

function isPending(status: number, body: unknown): boolean {
  return status === 202 && isJsonObject(body) && body.status === "pending_approval";
}

export async function dispatchTool(
  tool: McpTool,
  args: JsonObject,
  target: DispatchTarget,
): Promise<{ outcome: DispatchOutcome; response: Response | null }> {
  let request: Request;
  try {
    request = buildRequest(tool, args, target);
  } catch (error: unknown) {
    if (error instanceof ToolInputError) {
      return {
        outcome: {
          kind: "result",
          status: 422,
          result: errorResult("validation_failed", error.message),
        },
        response: null,
      };
    }
    throw error;
  }
  const response = await target.fetch(request);
  const body = await readBody(response);
  if (!response.ok) {
    const error = errorParts(body, response.status);
    if (response.status === 429 && error.code === "rate_limited") {
      return {
        outcome: {
          kind: "rate_limited",
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        response,
      };
    }
    return {
      outcome: {
        kind: "result",
        status: response.status,
        result: errorResult(error.code, error.message, error.details),
      },
      response,
    };
  }
  const pending = isPending(response.status, body);
  const structured: JsonObject = {
    untrusted_content: { ...untrustedSources[pending ? "community" : tool.contentSource] },
    status: response.status,
    result: stripInvisibleDeep(body),
  };
  const text = JSON.stringify(structured);
  if (Buffer.byteLength(text, "utf8") > target.maxResultBytes) {
    return {
      outcome: {
        kind: "result",
        status: 413,
        result: errorResult(
          "result_too_large",
          `The result is larger than ${target.maxResultBytes} bytes. Ask for fewer items with limit and page with cursor.`,
        ),
      },
      response,
    };
  }
  const lead =
    pending && isJsonObject(body)
      ? `Waiting for a person to approve this. Approval id ${String(body.approvalId)}. Nothing changed yet; do not retry. Check it with get_approval_status.\n`
      : "";
  return {
    outcome: {
      kind: "result",
      status: response.status,
      result: {
        content: [{ type: "text", text: `${lead}${text}` }],
        structuredContent: structured,
      },
    },
    response,
  };
}
