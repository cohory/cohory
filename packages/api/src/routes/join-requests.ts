import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import {
  decisionNoteMaxLength,
  type CommunitiesService,
  type JoinRequestQueueItem,
  type ManageService,
} from "@cohory/communities";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json, slugParams } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface JoinRequestRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  manage: ManageService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Manage"];
const staff = " Moderators, admins, and owners.";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community or the pending request does not exist."),
  409: errorResponse("The community is archived or full."),
  422: errorResponse("The input is invalid."),
};

const requestSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    email: z.string().nullable().openapi({ description: "Admins and owners only, else null." }),
    answers: z.array(z.object({ question: z.string(), answer: z.string() })),
    createdAt: z.iso.datetime(),
  })
  .openapi("JoinRequest");

const queueSchema = z
  .object({ data: z.array(requestSchema), ...pageCursor, pendingCount: z.int() })
  .openapi("JoinRequestQueue");

const decisionSchema = z
  .object({
    requestId: z.uuid(),
    userId: z.uuid(),
    status: z.enum(["approved", "declined"]),
  })
  .openapi("JoinDecision");

const decisionBodySchema = z
  .object({
    note: z.string().max(decisionNoteMaxLength).optional().openapi({
      description: "Shown to the person on the About page.",
    }),
  })
  .openapi("JoinDecisionInput");

const requestParams = slugParams.extend({
  requestId: z.uuid().openapi({ param: { name: "requestId", in: "path" } }),
});

function requestJson(item: JoinRequestQueueItem): z.infer<typeof requestSchema> {
  return {
    ...item,
    answers: item.answers.map((answer) => ({ ...answer })),
    createdAt: item.createdAt.toISOString(),
  };
}

const listRequests = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/requests",
  operationId: "listJoinRequests",
  "x-cohory": routeMeta("listJoinRequests"),
  tags,
  security,
  summary: "List pending join requests",
  description: `Oldest first, up to 100, with the answers to the join questions.${staff}`,
  request: { params: slugParams },
  responses: { 200: json(queueSchema, "Pending requests."), ...errors },
});

function decisionRoute(decision: "approve" | "decline") {
  return createRoute({
    method: "post",
    path: `/communities/{slug}/manage/requests/{requestId}/${decision}`,
    operationId: decision === "approve" ? "approveJoinRequest" : "declineJoinRequest",
    "x-cohory": routeMeta(decision === "approve" ? "approveJoinRequest" : "declineJoinRequest"),
    tags,
    security,
    summary: decision === "approve" ? "Approve a join request" : "Decline a join request",
    description:
      decision === "approve"
        ? `Makes the person an active member and tells them.${staff}`
        : `Closes the request and tells the person; they can ask again later.${staff}`,
    middleware: [writeLimit] as const,
    request: {
      params: requestParams,
      body: {
        required: false,
        content: { "application/json": { schema: decisionBodySchema } },
      },
    },
    responses: { 200: json(decisionSchema, "The decision."), ...errors },
  });
}

export function createJoinRequestRoutes(getDeps: () => JoinRequestRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/manage/requests", actor);
  app.use("/communities/:slug/manage/requests/*", actor);

  const manage = () => getDeps().manage;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  const routes = app.openapi(listRequests, async (c) => {
    const caller = c.get("actor");
    const queue = await manage().listJoinRequests(
      caller,
      await communityId(caller, c.req.valid("param").slug),
    );
    return c.json(
      { data: queue.data.map(requestJson), nextCursor: null, pendingCount: queue.pendingCount },
      200,
    );
  });
  for (const decision of ["approve", "decline"] as const) {
    routes.openapi(decisionRoute(decision), async (c) => {
      const caller = c.get("actor");
      const { slug, requestId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const body = c.req.valid("json");
      const input = body?.note ? { note: body.note } : {};
      const result =
        decision === "approve"
          ? await manage().approveJoinRequest(caller, id, requestId, input)
          : await manage().declineJoinRequest(caller, id, requestId, input);
      return c.json(result, 200);
    });
  }
  return app;
}
