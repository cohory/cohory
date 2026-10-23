import { createRoute, z } from "@hono/zod-openapi";
import {
  maxDecisionNoteLength,
  type ApprovalsService,
  type ApprovalView,
} from "@cohory/agents/approvals";
import { UnauthenticatedError, type Actor, type ApiCredential } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { canExecute } from "../approvals/catalog";
import type { ApprovalGateway } from "../approvals/gateway";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { errorResponse, json, slugParams } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 8 * 1024 });

export interface ApprovalsRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  approvals: ApprovalsService;
}

const tags = ["Approvals"];
const tokenSecurity: Record<string, string[]>[] = [{ bearerToken: [] }, { sessionCookie: [] }];
const sessionSecurity: Record<string, string[]>[] = [{ sessionCookie: [] }];
const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });

export const approvalStateSchema = z
  .enum(["pending", "approved", "executed", "failed", "rejected", "expired"])
  .openapi("ApprovalState", {
    description:
      "pending waits for a person; approved is running; executed ran once as the approving person; failed could not run; rejected was declined; expired was not decided within 72 hours.",
  });

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const approvalRequestSchema = z
  .object({
    id: z.uuid(),
    state: approvalStateSchema,
    operationId: z.string().openapi({ example: "removeMember" }),
    category: z.string().openapi({ example: "removal" }),
    summary: z.string().openapi({ example: "remove Sam Lee from the community" }),
    diff: z.array(
      z.object({ label: z.string(), before: z.string().nullable(), after: z.string().nullable() }),
    ),
    agent: personSchema.extend({ status: z.enum(["active", "suspended", "revoked"]) }),
    owner: personSchema,
    decidedBy: personSchema.nullable(),
    decidedAt: isoDate.nullable(),
    decisionNote: z.string().nullable(),
    executedAt: isoDate.nullable(),
    errorCode: z.string().nullable(),
    result: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "What the operation returned when it ran ({ status, data }), or { error } when it failed. Secrets are never stored.",
    }),
    download: z
      .object({
        available: z.boolean(),
        downloadedAt: isoDate.nullable(),
        availableUntil: isoDate,
        url: z.string(),
      })
      .nullable()
      .openapi({ description: "For approved downloads: a link that works once within 24 hours." }),
    executable: z.boolean().openapi({
      description: "False when Cohory cannot run this operation for an agent yet.",
    }),
    createdAt: isoDate,
    expiresAt: isoDate,
  })
  .openapi("ApprovalRequest");

export const approvalPendingSchema = z
  .object({
    status: z.literal("pending_approval"),
    approvalId: z.uuid(),
    summary: z.string(),
    expiresAt: isoDate,
    statusUrl: z.string().openapi({ example: "/api/v1/communities/makers/approvals/0192..." }),
  })
  .openapi("ApprovalPending", {
    description:
      "An agent asked for something a person must approve. Nothing changed yet. Poll statusUrl for the decision.",
  });

const approvalParams = slugParams.extend({
  approvalId: z.string().openapi({ param: { name: "approvalId", in: "path" } }),
});

const listQuery = z.object({
  view: z
    .enum(["pending", "history"])
    .optional()
    .openapi({ param: { name: "view", in: "query" }, example: "pending" }),
});

const rejectBody = z
  .object({ note: z.string().max(maxDecisionNoteLength).nullish() })
  .openapi("RejectApprovalRequest");

const decisionSchema = z
  .object({
    approval: approvalRequestSchema,
    revealed: z.record(z.string(), z.string()).nullable().openapi({
      description:
        "Values shown once to the approving person, such as a new webhook signing secret.",
    }),
  })
  .openapi("ApprovalDecision");

const errors = {
  401: errorResponse("Sign in or a token is required."),
  403: errorResponse(
    "Not allowed. For approve, also when the sign in is older than 10 minutes (code reauth_required).",
  ),
  404: errorResponse("The community or request does not exist or is not visible to the caller."),
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function approvalJson(view: ApprovalView, slug: string) {
  return {
    id: view.id,
    state: view.state,
    operationId: view.operationId,
    category: view.category,
    summary: view.summary,
    diff: view.diff.map((line) => ({ ...line })),
    agent: view.agent,
    owner: view.owner,
    decidedBy: view.decidedBy,
    decidedAt: iso(view.decidedAt),
    decisionNote: view.decisionNote,
    executedAt: iso(view.executedAt),
    errorCode: view.errorCode,
    result: view.result ? { ...view.result } : null,
    download: view.download
      ? {
          available: view.download.available,
          downloadedAt: iso(view.download.downloadedAt),
          availableUntil: view.download.availableUntil.toISOString(),
          url: `/api/v1/communities/${encodeURIComponent(slug)}/approvals/${view.id}/download`,
        }
      : null,
    executable: canExecute(view.operationId),
    createdAt: view.createdAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
  };
}

const listRequests = createRoute({
  method: "get",
  path: "/communities/{slug}/approvals",
  operationId: "listApprovalRequests",
  "x-cohory": routeMeta("listApprovalRequests"),
  tags,
  security: tokenSecurity,
  summary: "List your approval requests",
  description:
    "An agent sees the requests it made; a person sees requests made by their own agents. Newest first, up to 50.",
  request: { params: slugParams },
  responses: {
    200: json(z.object({ data: z.array(approvalRequestSchema), ...pageCursor }), "The requests."),
    ...errors,
  },
});

const getRequest = createRoute({
  method: "get",
  path: "/communities/{slug}/approvals/{approvalId}",
  operationId: "getApprovalRequest",
  "x-cohory": routeMeta("getApprovalRequest"),
  tags,
  security: tokenSecurity,
  summary: "Get an approval request",
  description:
    "The state of one request. Agents poll this after a 202 pending_approval answer until the state is executed, failed, rejected, or expired.",
  request: { params: approvalParams },
  responses: { 200: json(approvalRequestSchema, "The request."), ...errors },
});

const downloadResult = createRoute({
  method: "get",
  path: "/communities/{slug}/approvals/{approvalId}/download",
  operationId: "downloadApprovalResult",
  "x-cohory": routeMeta("downloadApprovalResult"),
  tags,
  security: tokenSecurity,
  summary: "Download an approved export",
  description:
    "For an approved download such as the members spreadsheet. Works once, within 24 hours of approval, for the agent that asked. The file is made at download time with the approving person's permissions.",
  request: { params: approvalParams },
  responses: {
    200: { description: "The file.", content: { "text/csv": { schema: z.string() } } },
    410: errorResponse("Already downloaded, expired, or not approved."),
    ...errors,
  },
});

const listManage = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/approvals",
  operationId: "listManageApprovals",
  "x-cohory": routeMeta("listManageApprovals"),
  tags,
  security: sessionSecurity,
  summary: "List approval requests",
  description:
    "Requests from agents in this community: pending ones, or the history of decided and expired ones. Owners and admins only.",
  request: { params: slugParams, query: listQuery },
  responses: {
    200: json(z.object({ data: z.array(approvalRequestSchema), ...pageCursor }), "The requests."),
    ...errors,
  },
});

const approveRequest = createRoute({
  method: "post",
  path: "/communities/{slug}/manage/approvals/{approvalId}/approve",
  operationId: "approveApprovalRequest",
  "x-cohory": routeMeta("approveApprovalRequest"),
  tags,
  security: sessionSecurity,
  summary: "Approve and run an agent's request",
  description:
    "Runs the recorded request once, as you, with your current permissions. Needs a sign in from the last 10 minutes. Approving twice returns the same result.",
  middleware: [writeLimit] as const,
  request: { params: approvalParams },
  responses: {
    200: json(decisionSchema, "The request after the decision."),
    409: errorResponse("The request expired or its agent was paused or revoked."),
    ...errors,
  },
});

const rejectRequest = createRoute({
  method: "post",
  path: "/communities/{slug}/manage/approvals/{approvalId}/reject",
  operationId: "rejectApprovalRequest",
  "x-cohory": routeMeta("rejectApprovalRequest"),
  tags,
  security: sessionSecurity,
  summary: "Reject an agent's request",
  description: "Nothing runs. The optional note is shown to the agent.",
  middleware: [writeLimit] as const,
  request: {
    params: approvalParams,
    body: { required: true, content: { "application/json": { schema: rejectBody } } },
  },
  responses: {
    200: json(approvalRequestSchema, "The request after the decision."),
    409: errorResponse("The request expired."),
    ...errors,
  },
});

function credentialOf(actor: Actor): ApiCredential {
  if (actor.kind !== "user" || !actor.credential || actor.credential.type !== "agent") {
    throw new UnauthenticatedError();
  }
  return actor.credential;
}

export function createApprovalsRoutes(
  getDeps: () => ApprovalsRouteDeps,
  gateway: () => ApprovalGateway,
) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/approvals", actor);
  app.use("/communities/:slug/approvals/*", actor);
  app.use("/communities/:slug/manage/approvals", actor);
  app.use("/communities/:slug/manage/approvals/*", actor);

  const approvals = () => getDeps().approvals;
  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listRequests, async (c) => {
      const caller = c.get("actor");
      const { slug } = c.req.valid("param");
      const views = await approvals().listForActor(caller, await communityId(caller, slug));
      return c.json({ data: views.map((view) => approvalJson(view, slug)), nextCursor: null }, 200);
    })
    .openapi(getRequest, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      const view = await approvals().get(caller, await communityId(caller, slug), approvalId);
      return c.json(approvalJson(view, slug), 200);
    })
    .openapi(downloadResult, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      await communityId(caller, slug);
      return gateway().download(credentialOf(caller), approvalId);
    })
    .openapi(listManage, async (c) => {
      const caller = c.get("actor");
      const { slug } = c.req.valid("param");
      const views = await approvals().list(
        caller,
        await communityId(caller, slug),
        c.req.valid("query").view ?? "pending",
      );
      return c.json({ data: views.map((view) => approvalJson(view, slug)), nextCursor: null }, 200);
    })
    .openapi(approveRequest, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const session = await getDeps().resolveSession(c.req.raw.headers);
      const decision = await gateway().approve(caller, id, approvalId, session?.signedInAt ?? null);
      return c.json(
        { approval: approvalJson(decision.view, slug), revealed: decision.revealed },
        200,
      );
    })
    .openapi(rejectRequest, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const view = await gateway().reject(caller, id, approvalId, c.req.valid("json").note ?? null);
      return c.json(approvalJson(view, slug), 200);
    });
}
