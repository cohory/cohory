import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { type CoursesService } from "@cohory/courses";
import {
  agentLicenseIds,
  type DelegationView,
  type EntitlementsService,
  type LicenseTerms,
  type SubmissionDetailView,
  type SubmissionView,
} from "@cohory/entitlements";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import type { ApprovalGateway } from "../approvals/gateway";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { approvalJson, approvalRequestSchema } from "./approvals";
import { errorResponse, json, slugParams } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 96 * 1024 });

export interface AgentAccessRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  entitlements: EntitlementsService;
  courses: CoursesService;
}

const tags = ["Agent access"];
const tokenSecurity: Record<string, string[]>[] = [{ bearerToken: [] }, { sessionCookie: [] }];
const sessionSecurity: Record<string, string[]>[] = [{ sessionCookie: [] }];
const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });
const errors = {
  401: errorResponse("Sign in or a token is required."),
  403: errorResponse(
    "Not allowed. Agents without an active delegation get code delegation_required with a reason.",
  ),
  404: errorResponse("The community, course, or delegation does not exist for the caller."),
  409: errorResponse("The request conflicts with the current state."),
  422: errorResponse("The input is invalid."),
};

const courseParams = slugParams.extend({
  courseId: z.uuid().openapi({ param: { name: "courseId", in: "path" } }),
});
const delegationParams = slugParams.extend({
  delegationId: z.string().openapi({ param: { name: "delegationId", in: "path" } }),
});
const approvalParams = slugParams.extend({
  approvalId: z.string().openapi({ param: { name: "approvalId", in: "path" } }),
});

export const licenseSchema = z
  .object({
    id: z.enum(agentLicenseIds),
    label: z.string(),
    summary: z.string(),
    text: z.string().nullable(),
  })
  .openapi("AgentLicense", {
    description: "Terms for agents reading this course, shown at checkout and when delegating.",
  });

const settingsSchema = z
  .object({ courseId: z.uuid(), allowAgentAccess: z.boolean(), license: licenseSchema })
  .openapi("CourseAgentSettings");

const delegationStateSchema = z
  .object({
    kind: z.enum(["active", "paused", "ended"]),
    reason: z.string().nullable().openapi({
      description:
        "Why access is paused or ended: revoked, expired, access_ended, agent_inactive, agent_access_off, human_access_ended.",
    }),
  })
  .openapi("DelegationState");

const delegationSchema = z
  .object({
    id: z.uuid(),
    courseId: z.uuid(),
    agent: z.object({ id: z.uuid(), name: z.string() }),
    grantedAt: isoDate,
    expiresAt: isoDate,
    renewedAt: isoDate.nullable(),
    revokedAt: isoDate.nullable(),
    state: delegationStateSchema,
  })
  .openapi("CourseDelegation");

const accessSchema = z
  .object({
    settings: settingsSchema,
    canManage: z.boolean(),
    canDelegate: z.boolean(),
    agents: z.array(z.object({ id: z.uuid(), name: z.string() })),
    delegations: z.array(delegationSchema),
  })
  .openapi("CourseAgentAccess");

const settingsBody = z
  .object({
    allowAgentAccess: z.boolean(),
    licenseId: z.enum(agentLicenseIds),
    licenseText: z.string().max(2000).nullish(),
  })
  .openapi("UpdateCourseAgentSettings");

const createDelegationBody = z
  .object({ courseId: z.uuid(), agentId: z.uuid() })
  .openapi("CreateCourseDelegation");

const submissionBody = z
  .object({
    lessonId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200),
    version: z.string().min(1).max(64).openapi({ example: "1.0.0" }),
    runId: z.string().min(1).max(200).openapi({
      description: "Your own id for this run. One result per agent, run, and task.",
    }),
    payload: z.unknown().openapi({ description: "Your result as JSON, up to 64 KiB." }),
  })
  .openapi("SubmitAgentResult");

const submissionSchema = z
  .object({
    id: z.uuid(),
    courseId: z.uuid(),
    lessonId: z.string(),
    taskId: z.string(),
    version: z.string(),
    runId: z.string(),
    label: z.literal("self_reported").openapi({
      description: "Cohory stores what the agent reported and never calls it verified.",
    }),
    agent: z.object({ id: z.uuid(), name: z.string() }),
    createdAt: isoDate,
  })
  .openapi("AgentSubmission");

const submissionDetailSchema = submissionSchema
  .extend({ payload: z.unknown() })
  .openapi("AgentSubmissionDetail");

const summarySchema = z
  .object({
    lessonId: z.string(),
    taskId: z.string(),
    version: z.string(),
    submissions: z.number().int(),
    agents: z.number().int(),
    members: z.number().int(),
    latestAt: isoDate,
  })
  .openapi("AgentSubmissionSummary");

const purchaseDecisionSchema = z
  .object({
    approval: approvalRequestSchema,
    checkoutUrl: z.string().nullable().openapi({
      description:
        "Stripe Checkout for the person to finish. Approving never charges anything by itself.",
    }),
  })
  .openapi("PurchaseDecision");

function body<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const getAgentAccess = createRoute({
  method: "get",
  path: "/communities/{slug}/courses/{courseId}/agent-access",
  operationId: "getCourseAgentAccess",
  "x-cohory": routeMeta("getCourseAgentAccess"),
  tags,
  security: tokenSecurity,
  summary: "Get agent access for a course",
  description:
    "Whether the creator allows agents, the license terms, and for a signed in person their own agents and delegations of this course.",
  request: { params: courseParams },
  responses: { 200: json(accessSchema, "Agent access for the course."), ...errors },
});

const updateAgentAccess = createRoute({
  method: "put",
  path: "/communities/{slug}/courses/{courseId}/agent-access",
  operationId: "updateCourseAgentAccess",
  "x-cohory": routeMeta("updateCourseAgentAccess"),
  tags,
  security: sessionSecurity,
  summary: "Turn agent access on or off and choose license terms",
  description:
    "Admins and owners only, from a signed in session. Turning access off ends every delegation of the course.",
  middleware: [writeLimit] as const,
  request: { params: courseParams, ...body(settingsBody) },
  responses: { 200: json(settingsSchema, "The saved settings."), ...errors },
});

const listDelegations = createRoute({
  method: "get",
  path: "/communities/{slug}/delegations",
  operationId: "listMyDelegations",
  "x-cohory": routeMeta("listMyDelegations"),
  tags,
  security: sessionSecurity,
  summary: "List the courses you shared with your agents",
  request: { params: slugParams },
  responses: {
    200: json(
      z.object({ data: z.array(delegationSchema), ...pageCursor }),
      "Your delegations, newest first.",
    ),
    ...errors,
  },
});

const createDelegation = createRoute({
  method: "post",
  path: "/communities/{slug}/delegations",
  operationId: "createDelegation",
  "x-cohory": routeMeta("createDelegation"),
  tags,
  security: sessionSecurity,
  summary: "Give one of your agents read access to a course",
  description:
    "You need access to the course and the creator must allow agents. Access lasts 30 days, can be renewed or revoked, and ends when your own access ends. Agents cannot call this.",
  middleware: [writeLimit] as const,
  request: { params: slugParams, ...body(createDelegationBody) },
  responses: { 201: json(delegationSchema, "The new delegation."), ...errors },
});

function delegationAction(action: "renew" | "revoke") {
  const operationId = action === "renew" ? "renewDelegation" : "revokeDelegation";
  return createRoute({
    method: "post",
    path: `/communities/{slug}/delegations/{delegationId}/${action}`,
    operationId,
    "x-cohory": routeMeta(operationId),
    tags,
    security: sessionSecurity,
    summary: action === "renew" ? "Renew a delegation for 30 days" : "Revoke a delegation",
    middleware: [writeLimit] as const,
    request: { params: delegationParams },
    responses: { 200: json(delegationSchema, "The delegation."), ...errors },
  });
}

const renewDelegation = delegationAction("renew");
const revokeDelegation = delegationAction("revoke");

const submitResult = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseId}/submissions",
  operationId: "submitAgentResult",
  "x-cohory": routeMeta("submitAgentResult"),
  tags,
  security: tokenSecurity,
  summary: "Submit a self reported evaluation result",
  description:
    "Agent tokens only, with access to the course. The lesson, task, and version must exist in the published agent material. The result is stored as self reported and attributed to the agent, its person, the version, and the run.",
  middleware: [writeLimit] as const,
  request: { params: courseParams, ...body(submissionBody) },
  responses: { 201: json(submissionSchema, "The stored result."), ...errors },
});

const listSubmissions = createRoute({
  method: "get",
  path: "/communities/{slug}/courses/{courseId}/submissions",
  operationId: "listAgentSubmissions",
  "x-cohory": routeMeta("listAgentSubmissions"),
  tags,
  security: tokenSecurity,
  summary: "List your agents' results for a course",
  description: "A person sees results of their own agents; an agent sees its own. Newest first.",
  request: { params: courseParams },
  responses: {
    200: json(z.object({ data: z.array(submissionDetailSchema), ...pageCursor }), "Results."),
    ...errors,
  },
});

const submissionSummary = createRoute({
  method: "get",
  path: "/communities/{slug}/courses/{courseId}/submissions/summary",
  operationId: "getAgentSubmissionSummary",
  "x-cohory": routeMeta("getAgentSubmissionSummary"),
  tags,
  security: tokenSecurity,
  summary: "Count results per task",
  description:
    "Admins and owners. Counts only: payloads of members' agents are never shown to the creator.",
  request: { params: courseParams },
  responses: {
    200: json(
      z.object({ data: z.array(summarySchema), ...pageCursor }),
      "Counts per lesson, task, and version.",
    ),
    ...errors,
  },
});

const listPurchases = createRoute({
  method: "get",
  path: "/communities/{slug}/purchase-requests",
  operationId: "listPurchaseRequests",
  "x-cohory": routeMeta("listPurchaseRequests"),
  tags,
  security: sessionSecurity,
  summary: "List purchases your agents proposed",
  request: { params: slugParams },
  responses: {
    200: json(
      z.object({ data: z.array(approvalRequestSchema), ...pageCursor }),
      "Purchase requests.",
    ),
    ...errors,
  },
});

const approvePurchase = createRoute({
  method: "post",
  path: "/communities/{slug}/purchase-requests/{approvalId}/approve",
  operationId: "approvePurchaseRequest",
  "x-cohory": routeMeta("approvePurchaseRequest"),
  tags,
  security: sessionSecurity,
  summary: "Approve a purchase your agent proposed",
  description:
    "Starts Stripe Checkout for you. Nothing is charged until you finish checkout yourself.",
  middleware: [writeLimit] as const,
  request: { params: approvalParams },
  responses: { 200: json(purchaseDecisionSchema, "The decision and where to pay."), ...errors },
});

const rejectPurchase = createRoute({
  method: "post",
  path: "/communities/{slug}/purchase-requests/{approvalId}/reject",
  operationId: "rejectPurchaseRequest",
  "x-cohory": routeMeta("rejectPurchaseRequest"),
  tags,
  security: sessionSecurity,
  summary: "Decline a purchase your agent proposed",
  middleware: [writeLimit] as const,
  request: { params: approvalParams },
  responses: { 200: json(approvalRequestSchema, "The declined request."), ...errors },
});

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function licenseJson(license: LicenseTerms) {
  return { id: license.id, label: license.label, summary: license.summary, text: license.text };
}

function delegationJson(view: DelegationView) {
  return {
    id: view.id,
    courseId: view.courseId,
    agent: view.agent,
    grantedAt: view.grantedAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
    renewedAt: iso(view.renewedAt),
    revokedAt: iso(view.revokedAt),
    state: {
      kind: view.state.kind,
      reason: view.state.kind === "active" ? null : view.state.reason,
    },
  };
}

function submissionJson(view: SubmissionView) {
  return {
    id: view.id,
    courseId: view.courseId,
    lessonId: view.lessonId,
    taskId: view.taskId,
    version: view.version,
    runId: view.runId,
    label: view.label,
    agent: view.agent,
    createdAt: view.createdAt.toISOString(),
  };
}

function submissionDetailJson(view: SubmissionDetailView) {
  return { ...submissionJson(view), payload: view.payload };
}

export function createAgentAccessRoutes(
  getDeps: () => AgentAccessRouteDeps,
  gateway: () => ApprovalGateway,
) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/courses/:courseId/agent-access", actor);
  app.use("/communities/:slug/courses/:courseId/submissions", actor);
  app.use("/communities/:slug/courses/:courseId/submissions/*", actor);
  app.use("/communities/:slug/delegations", actor);
  app.use("/communities/:slug/delegations/*", actor);
  app.use("/communities/:slug/purchase-requests", actor);
  app.use("/communities/:slug/purchase-requests/*", actor);

  const entitlements = () => getDeps().entitlements;
  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(getAgentAccess, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const view = await entitlements().getCourseAgentAccess(
        caller,
        await communityId(caller, slug),
        courseId,
      );
      return c.json(
        {
          settings: {
            courseId: view.settings.courseId,
            allowAgentAccess: view.settings.allowAgentAccess,
            license: licenseJson(view.settings.license),
          },
          canManage: view.canManage,
          canDelegate: view.canDelegate,
          agents: view.agents.map((agent) => ({ id: agent.id, name: agent.name })),
          delegations: view.delegations.map(delegationJson),
        },
        200,
      );
    })
    .openapi(updateAgentAccess, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const saved = await entitlements().updateCourseAgentSettings(
        caller,
        await communityId(caller, slug),
        courseId,
        c.req.valid("json"),
      );
      return c.json(
        {
          courseId: saved.courseId,
          allowAgentAccess: saved.allowAgentAccess,
          license: licenseJson(saved.license),
        },
        200,
      );
    })
    .openapi(listDelegations, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const views = await entitlements().listMyDelegations(caller, id);
      return c.json({ data: views.map(delegationJson), nextCursor: null }, 200);
    })
    .openapi(createDelegation, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const view = await entitlements().createDelegation(caller, id, c.req.valid("json"));
      return c.json(delegationJson(view), 201);
    })
    .openapi(renewDelegation, async (c) => {
      const caller = c.get("actor");
      const { slug, delegationId } = c.req.valid("param");
      const view = await entitlements().renewDelegation(
        caller,
        await communityId(caller, slug),
        delegationId,
      );
      return c.json(delegationJson(view), 200);
    })
    .openapi(revokeDelegation, async (c) => {
      const caller = c.get("actor");
      const { slug, delegationId } = c.req.valid("param");
      const view = await entitlements().revokeDelegation(
        caller,
        await communityId(caller, slug),
        delegationId,
      );
      return c.json(delegationJson(view), 200);
    })
    .openapi(submitResult, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const input = c.req.valid("json");
      const id = await communityId(caller, slug);
      await getDeps().courses.getAgentTask(
        caller,
        id,
        courseId,
        input.lessonId,
        input.taskId,
        input.version,
      );
      const view = await entitlements().submitAgentResult(caller, { ...input, courseId });
      return c.json(submissionJson(view), 201);
    })
    .openapi(listSubmissions, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const views = await entitlements().listSubmissions(
        caller,
        await communityId(caller, slug),
        courseId,
      );
      return c.json({ data: views.map(submissionDetailJson), nextCursor: null }, 200);
    })
    .openapi(submissionSummary, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const rows = await entitlements().submissionSummary(
        caller,
        await communityId(caller, slug),
        courseId,
      );
      return c.json(
        {
          data: rows.map((row) => ({ ...row, latestAt: row.latestAt.toISOString() })),
          nextCursor: null,
        },
        200,
      );
    })
    .openapi(listPurchases, async (c) => {
      const caller = c.get("actor");
      const { slug } = c.req.valid("param");
      const views = await gateway().listPurchases(caller, await communityId(caller, slug));
      return c.json({ data: views.map((view) => approvalJson(view, slug)), nextCursor: null }, 200);
    })
    .openapi(approvePurchase, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      const decision = await gateway().approvePurchase(
        caller,
        await communityId(caller, slug),
        approvalId,
      );
      return c.json(
        { approval: approvalJson(decision.view, slug), checkoutUrl: decision.checkoutUrl },
        200,
      );
    })
    .openapi(rejectPurchase, async (c) => {
      const caller = c.get("actor");
      const { slug, approvalId } = c.req.valid("param");
      const view = await gateway().rejectPurchase(
        caller,
        await communityId(caller, slug),
        approvalId,
      );
      return c.json(approvalJson(view, slug), 200);
    });
}
