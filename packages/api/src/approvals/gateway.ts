import {
  ApprovalsError,
  type ApprovalRecordedInput,
  type ApprovalsService,
  type ApprovalView,
  type ClaimedRequest,
} from "@cohory/agents/approvals";
import {
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type ApiCredential,
  type ApprovalCategory,
} from "@cohory/authz";
import type { Context } from "hono";

import { agentNotAllowedMessage, errorJson, validationError } from "../errors";
import type { CohoryRouteExtension } from "../route-meta";
import {
  canExecute,
  downloadOperations,
  isForbiddenForAgents,
  labelFor,
  requiredActionFor,
  unproposableOperations,
} from "./catalog";
import { describeProposal, maxDiffLines } from "./describe";
import type { Replay } from "./replay";

export interface SchemaParser {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: unknown }
    | { readonly success: false; readonly error: { readonly issues: readonly Issue[] } };
}

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export interface RouteRequestSchemas {
  readonly params?: SchemaParser;
  readonly query?: SchemaParser;
  readonly json?: SchemaParser;
  readonly multipart: boolean;
}

export interface ProposalContext {
  readonly meta: CohoryRouteExtension;
  readonly request: RouteRequestSchemas | null;
  readonly params: Readonly<Record<string, string>>;
  readonly credential: ApiCredential;
  readonly userId: string;
  readonly communitySlug: string;
  readonly category: ApprovalCategory;
}

export interface ApprovalDecision {
  readonly view: ApprovalView;
  readonly revealed: Readonly<Record<string, string>> | null;
}

export interface PurchaseDecision {
  readonly view: ApprovalView;
  readonly checkoutUrl: string | null;
}

export interface ApprovalGatewayDeps {
  readonly approvals: () => ApprovalsService;
  readonly replay: Replay;
}

export type Proposability =
  { readonly kind: "proposable" } | { readonly kind: "refused"; readonly message: string };

const revealedKeys = ["secret", "token"] as const;
const maxStoredResult = 8 * 1024;

export function isSchemaParser(value: unknown): value is SchemaParser {
  return (
    value !== null &&
    typeof value === "object" &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

export function proposability(
  meta: CohoryRouteExtension,
  method: string,
  request: RouteRequestSchemas | null,
): Proposability {
  const refusal = unproposableOperations.get(meta.operationId);
  if (refusal) {
    return { kind: "refused", message: refusal };
  }
  if (request?.multipart) {
    return {
      kind: "refused",
      message:
        "This needs a file upload, which an agent cannot ask for. A person must do it in Cohory.",
    };
  }
  if (method === "GET" && !downloadOperations.has(meta.operationId)) {
    return {
      kind: "refused",
      message:
        "An agent cannot read this, and reading it cannot be approved. A person can see it in Cohory.",
    };
  }
  return { kind: "proposable" };
}

function issuePaths(prefix: string, issues: readonly Issue[]) {
  return issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}

function keptKeys(raw: Readonly<Record<string, string>>, parsed: unknown): Record<string, string> {
  if (parsed === null || typeof parsed !== "object") {
    return {};
  }
  return Object.fromEntries(Object.entries(raw).filter(([key]) => Object.hasOwn(parsed, key)));
}

function normalizedBody(schema: SchemaParser, parsed: unknown): unknown {
  const stored: unknown = JSON.parse(JSON.stringify(parsed ?? null));
  const again = schema.safeParse(stored);
  return again.success && JSON.stringify(again.data ?? null) === JSON.stringify(stored)
    ? stored
    : undefined;
}

async function recordInput(
  c: Context,
  context: ProposalContext,
): Promise<{ input: ApprovalRecordedInput } | { issues: { path: string; message: string }[] }> {
  const schemas = context.request;
  const parsedParams = schemas?.params?.safeParse(context.params);
  if (parsedParams && !parsedParams.success) {
    return { issues: issuePaths("params", parsedParams.error.issues) };
  }
  const rawQuery = c.req.query();
  const parsedQuery = schemas?.query?.safeParse(rawQuery);
  if (parsedQuery && !parsedQuery.success) {
    return { issues: issuePaths("query", parsedQuery.error.issues) };
  }
  let body: unknown = null;
  if (schemas?.json) {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return { issues: [{ path: "body", message: "The body must be JSON." }] };
    }
    const parsedBody = schemas.json.safeParse(raw);
    if (!parsedBody.success) {
      return { issues: issuePaths("body", parsedBody.error.issues) };
    }
    body = normalizedBody(schemas.json, parsedBody.data);
    if (body === undefined) {
      return {
        issues: [{ path: "body", message: "This request cannot be recorded for approval." }],
      };
    }
  }
  return {
    input: {
      params: parsedParams ? keptKeys(context.params, parsedParams.data) : { ...context.params },
      query: parsedQuery ? keptKeys(rawQuery, parsedQuery.data) : {},
      body,
    },
  };
}

function errorCodeOf(body: unknown): { code: string | null; message: string | null } {
  if (body !== null && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error !== null && typeof error === "object") {
      const code = "code" in error && typeof error.code === "string" ? error.code : null;
      const message =
        "message" in error && typeof error.message === "string" ? error.message : null;
      return { code, message };
    }
  }
  return { code: null, message: null };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function splitSecrets(body: unknown): {
  data: unknown;
  revealed: Record<string, string> | null;
} {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { data: body, revealed: null };
  }
  const data: Record<string, unknown> = {};
  const revealed: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if ((revealedKeys as readonly string[]).includes(key) && typeof value === "string") {
      revealed[key] = value;
    } else {
      data[key] = value;
    }
  }
  return { data, revealed: Object.keys(revealed).length > 0 ? revealed : null };
}

function storedResult(status: number, data: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(data ?? null);
  if (serialized.length <= maxStoredResult) {
    return { status, data: data ?? null };
  }
  const id =
    data !== null && typeof data === "object" && "id" in data && typeof data.id === "string"
      ? data.id
      : null;
  return { status, data: { id }, truncated: true };
}

export function containedPath(path: string, bases: readonly string[]): string | null {
  const origin = "http://contained.invalid";
  const resolved = new URL(path, origin);
  if (resolved.origin !== origin || resolved.search !== "" || resolved.hash !== "") {
    return null;
  }
  const inside = bases.some((base) => {
    const root = new URL(base, origin).pathname;
    return resolved.pathname === root || resolved.pathname.startsWith(`${root}/`);
  });
  return inside ? resolved.pathname : null;
}

export function createApprovalGateway(deps: ApprovalGatewayDeps) {
  function readAsOwner(userId: string, bases: readonly string[]) {
    return async (path: string): Promise<Record<string, unknown> | null> => {
      const contained = containedPath(path, bases);
      if (contained === null) {
        return null;
      }
      const response = await deps.replay({
        userId,
        agentId: null,
        method: "GET",
        path: contained,
        input: { params: {}, query: {}, body: null },
      });
      if (!response.ok) {
        return null;
      }
      const body = await readJson(response);
      return body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    };
  }

  async function execute(request: ClaimedRequest): Promise<ApprovalDecision> {
    const approvals = deps.approvals();
    if (isForbiddenForAgents(request.operationId)) {
      const view = await approvals.finish(request, {
        kind: "failed",
        errorCode: "not_allowed_for_agents",
        result: { error: { code: "not_allowed_for_agents", message: agentNotAllowedMessage } },
      });
      return { view, revealed: null };
    }
    if (!canExecute(request.operationId)) {
      const view = await approvals.finish(request, {
        kind: "failed",
        errorCode: "not_supported",
        result: {
          error: {
            code: "not_supported",
            message: `Cohory cannot ${labelFor(request.operationId)} for an agent yet. Do it yourself in Cohory.`,
          },
        },
      });
      return { view, revealed: null };
    }
    if (downloadOperations.has(request.operationId)) {
      const view = await approvals.finish(request, {
        kind: "executed",
        result: { download: true },
      });
      return { view, revealed: null };
    }
    let response: Response;
    try {
      response = await deps.replay({
        userId: request.approverId,
        agentId: request.agentId,
        method: request.method,
        path: request.path,
        input: request.input,
      });
    } catch (error: unknown) {
      await approvals.finish(request, { kind: "failed", errorCode: "internal_error" });
      throw error;
    }
    const body = await readJson(response);
    if (response.ok) {
      const { data, revealed } = splitSecrets(body);
      const view = await approvals.finish(request, {
        kind: "executed",
        result: storedResult(response.status, data),
      });
      return { view, revealed };
    }
    const { code, message } = errorCodeOf(body);
    if (response.status === 403 && (code === "forbidden" || code === null)) {
      await approvals.finish(request, { kind: "released" });
      throw new ForbiddenError("approve", "approval");
    }
    if (response.status === 401) {
      await approvals.finish(request, { kind: "released" });
      throw new UnauthenticatedError();
    }
    const errorCode = code ?? `http_${response.status}`;
    const view = await approvals.finish(request, {
      kind: "failed",
      errorCode,
      result: { status: response.status, error: { code: errorCode, message } },
    });
    return { view, revealed: null };
  }

  return {
    async propose(c: Context, context: ProposalContext): Promise<Response> {
      const recorded = await recordInput(c, context);
      if ("issues" in recorded) {
        return errorJson(c, validationError(recorded.issues));
      }
      const slugBase = `/api/v1/communities/${encodeURIComponent(context.communitySlug)}`;
      const idBase = `/api/v1/communities/${encodeURIComponent(context.credential.communityId)}`;
      const described = await describeProposal(context.meta.operationId, {
        input: recorded.input,
        slugBase,
        idBase,
        read: readAsOwner(context.userId, [slugBase, idBase]),
      });
      if (described.kind === "too_large") {
        return errorJson(
          c,
          validationError([
            {
              path: "body",
              message: `This changes ${described.lines} fields at once. Ask for at most ${maxDiffLines} changes in one request.`,
            },
          ]),
        );
      }
      const view = await deps.approvals().propose(context.credential, context.userId, {
        operationId: context.meta.operationId,
        method: c.req.method,
        path: c.req.path,
        category: context.category,
        input: recorded.input,
        summary: described.summary,
        diff: described.diff,
      });
      const statusUrl = `${slugBase}/approvals/${view.id}`;
      c.header("Location", statusUrl);
      return c.json(
        {
          status: "pending_approval" as const,
          approvalId: view.id,
          summary: view.summary,
          expiresAt: view.expiresAt.toISOString(),
          statusUrl,
        },
        202,
      );
    },

    async approve(
      actor: Actor,
      communityId: string,
      approvalId: string,
      signedInAt: Date | null,
    ): Promise<ApprovalDecision> {
      const outcome = await deps.approvals().claim(actor, communityId, approvalId, {
        signedInAt,
        requiredAction: requiredActionFor,
      });
      if (outcome.kind === "decided") {
        return { view: outcome.view, revealed: null };
      }
      return execute(outcome.request);
    },

    async approvePurchase(
      actor: Actor,
      communityId: string,
      approvalId: string,
    ): Promise<PurchaseDecision> {
      const approvals = deps.approvals();
      const outcome = await approvals.claimPurchase(actor, communityId, approvalId);
      if (outcome.kind === "decided") {
        return { view: outcome.view, checkoutUrl: null };
      }
      const request = outcome.request;
      let response: Response;
      try {
        response = await deps.replay({
          userId: request.approverId,
          agentId: request.agentId,
          method: request.method,
          path: request.path,
          input: request.input,
        });
      } catch (error: unknown) {
        await approvals.finish(request, { kind: "failed", errorCode: "internal_error" });
        throw error;
      }
      const body = await readJson(response);
      const url =
        response.ok && body !== null && typeof body === "object" && "url" in body ? body.url : null;
      if (typeof url === "string") {
        const view = await approvals.finish(request, {
          kind: "executed",
          result: { status: response.status, data: { checkout: "started" } },
        });
        return { view, checkoutUrl: url };
      }
      const { code, message } = errorCodeOf(body);
      const errorCode = code ?? `http_${response.status}`;
      const view = await approvals.finish(request, {
        kind: "failed",
        errorCode,
        result: { status: response.status, error: { code: errorCode, message } },
      });
      return { view, checkoutUrl: null };
    },

    listPurchases(actor: Actor, communityId: string): Promise<ApprovalView[]> {
      return deps.approvals().listPurchaseRequests(actor, communityId);
    },

    rejectPurchase(actor: Actor, communityId: string, approvalId: string): Promise<ApprovalView> {
      return deps.approvals().rejectPurchase(actor, communityId, approvalId);
    },

    reject(
      actor: Actor,
      communityId: string,
      approvalId: string,
      note: string | null,
    ): Promise<ApprovalView> {
      return deps.approvals().reject(actor, communityId, approvalId, note);
    },

    async download(credential: ApiCredential, approvalId: string): Promise<Response> {
      const approvals = deps.approvals();
      const claim = await approvals.claimDownload(credential, approvalId);
      const response = await deps.replay({
        userId: claim.approverId,
        agentId: credential.agentId,
        method: claim.method,
        path: claim.path,
        input: claim.input,
      });
      if (!response.ok) {
        await approvals.releaseDownload(claim);
        if (response.status === 403) {
          throw new ApprovalsError("download_unavailable");
        }
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    },
  };
}

export type ApprovalGateway = ReturnType<typeof createApprovalGateway>;
