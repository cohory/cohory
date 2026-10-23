import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { webhookEventTypes } from "@cohory/events";
import {
  maxDeliveriesPageSize,
  maxResendBatch,
  type WebhookDeliveryDetail,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhooksService,
} from "@cohory/webhooks";
import { bodyLimit } from "hono/body-limit";

import { cursorQuery, pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta, type OperationId } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json, page, slugParams } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface WebhooksRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  webhooks: WebhooksService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Webhooks"];
const managers = " Admins and owners only.";
const base = "/communities/{slug}/manage/webhooks";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not an admin or the owner of the community."),
  404: errorResponse("The community or endpoint does not exist or is not visible to the caller."),
  422: errorResponse("The input is invalid."),
};
const conflict = errorResponse(
  "The community is archived, the endpoint is turned off, or the community has 20 endpoints.",
);

const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });
const eventType = z.enum(webhookEventTypes).openapi("WebhookEventType", {
  description: "A published domain event. Payloads carry ids and statuses only.",
});

const endpointSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    description: z.string().nullable(),
    eventTypes: z.array(eventType),
    status: z.enum(["active", "disabled"]),
    disabledReason: z.enum(["manual", "failures"]).nullable().openapi({
      description: "Why the endpoint is off: turned off by a person or after failures.",
    }),
    disabledAt: isoDate.nullable(),
    failingSince: isoDate
      .nullable()
      .openapi({ description: "First failure since the last successful delivery." }),
    consecutiveFailures: z.int().min(0),
    lastSuccessAt: isoDate.nullable(),
    previousSecretExpiresAt: isoDate.nullable().openapi({
      description:
        "While set, deliveries are also signed with the secret from before the last rotation, until this time.",
    }),
    createdAt: isoDate,
  })
  .openapi("WebhookEndpoint");

const endpointWithSecretSchema = z
  .object({
    endpoint: endpointSchema,
    secret: z.string().openapi({
      description:
        "Signing secret in the Standard Webhooks whsec_ format. Shown only in this response.",
      example: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    }),
  })
  .openapi("WebhookEndpointWithSecret");

const deliverySchema = z
  .object({
    id: z.uuid(),
    eventId: z.string().openapi({ description: "Sent as the webhook-id header." }),
    eventType: z.string(),
    status: z.enum(["pending", "succeeded", "failed"]),
    attempts: z.int().min(0),
    responseStatus: z.int().nullable(),
    lastError: z
      .string()
      .nullable()
      .openapi({ example: "http_500", description: "Short error code of the last attempt." }),
    lastAttemptAt: isoDate.nullable(),
    nextAttemptAt: isoDate.nullable(),
    createdAt: isoDate,
  })
  .openapi("WebhookDelivery");

const attemptSchema = z
  .object({
    at: isoDate,
    requestHeaders: z.record(z.string(), z.string()).openapi({
      description: "Headers sent, including the signatures. Never the signing secret.",
    }),
    requestBody: z.string(),
    responseStatus: z.int().nullable(),
    responseBodyExcerpt: z
      .string()
      .nullable()
      .openapi({ description: "The first 2048 characters of the receiver's answer." }),
    errorCode: z.string().nullable().openapi({ example: "connection_failed" }),
    durationMs: z.int().min(0).nullable(),
  })
  .openapi("WebhookDeliveryAttempt");

const deliveryDetailSchema = z
  .object({
    delivery: deliverySchema,
    payload: z.object({
      type: z.string(),
      timestamp: isoDate,
      data: z.record(z.string(), z.unknown()),
    }),
    attempts: z.array(attemptSchema).openapi({ description: "Newest first, up to 50." }),
  })
  .openapi("WebhookDeliveryDetail");

const rotateBodySchema = z
  .object({
    keepPrevious: z.boolean().optional().openapi({
      description:
        "Keep signing with the old secret too for 24 hours, so the receiver can switch without missing events. Defaults to false.",
    }),
  })
  .openapi("RotateWebhookSecret");

const resendFailedBodySchema = z
  .object({
    since: z.iso
      .datetime({ offset: true })
      .openapi({ description: "Resend failed deliveries created at or after this time." }),
  })
  .openapi("ResendFailedWebhookDeliveries");

const createBodySchema = z
  .object({
    url: z.string().max(2048).openapi({ example: "https://hooks.example.com/cohory" }),
    description: z.string().max(200).nullish(),
    eventTypes: z.array(eventType).min(1),
  })
  .openapi("CreateWebhookEndpoint");

const updateBodySchema = z
  .object({
    url: z.string().max(2048).optional(),
    description: z.string().max(200).nullish(),
    eventTypes: z.array(eventType).min(1).optional(),
  })
  .openapi("UpdateWebhookEndpoint");

const endpointParams = slugParams.extend({
  endpointId: z.string().openapi({ param: { name: "endpointId", in: "path" } }),
});

const deliveryParams = endpointParams.extend({
  deliveryId: z.string().openapi({ param: { name: "deliveryId", in: "path" } }),
});

const deliveriesQuerySchema = z.object({
  ...cursorQuery({ max: maxDeliveriesPageSize, example: 25 }),
});

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function endpointJson(view: WebhookEndpointView) {
  return {
    ...view,
    eventTypes: [...view.eventTypes],
    disabledAt: iso(view.disabledAt),
    failingSince: iso(view.failingSince),
    lastSuccessAt: iso(view.lastSuccessAt),
    previousSecretExpiresAt: iso(view.previousSecretExpiresAt),
    createdAt: view.createdAt.toISOString(),
  };
}

function deliveryJson(view: WebhookDeliveryView) {
  return {
    ...view,
    lastAttemptAt: iso(view.lastAttemptAt),
    nextAttemptAt: iso(view.nextAttemptAt),
    createdAt: view.createdAt.toISOString(),
  };
}

function deliveryDetailJson(detail: WebhookDeliveryDetail) {
  return {
    delivery: deliveryJson(detail.delivery),
    payload: detail.payload,
    attempts: detail.attempts.map((attempt) => ({ ...attempt, at: attempt.at.toISOString() })),
  };
}

function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const listEndpoints = createRoute({
  method: "get",
  path: base,
  operationId: "listWebhookEndpoints",
  "x-cohory": routeMeta("listWebhookEndpoints"),
  tags,
  security,
  summary: "List webhook endpoints",
  description: `Endpoints that receive signed events from this community. Secrets are never listed.${managers}`,
  request: { params: slugParams },
  responses: {
    200: json(z.object({ data: z.array(endpointSchema), ...pageCursor }), "The endpoints."),
    ...errors,
  },
});

const createEndpoint = createRoute({
  method: "post",
  path: base,
  operationId: "createWebhookEndpoint",
  "x-cohory": routeMeta("createWebhookEndpoint"),
  tags,
  security,
  summary: "Add a webhook endpoint",
  description: `Registers an https URL for the chosen events and returns its signing secret once. Up to 20 endpoints per community.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: slugParams, ...jsonBody(createBodySchema) },
  responses: {
    201: json(endpointWithSecretSchema, "The endpoint and its secret."),
    409: conflict,
    ...errors,
  },
});

const getEndpoint = createRoute({
  method: "get",
  path: `${base}/{endpointId}`,
  operationId: "getWebhookEndpoint",
  "x-cohory": routeMeta("getWebhookEndpoint"),
  tags,
  security,
  summary: "Get a webhook endpoint",
  description: `One endpoint with its failure counters.${managers}`,
  request: { params: endpointParams },
  responses: { 200: json(endpointSchema, "The endpoint."), ...errors },
});

const updateEndpoint = createRoute({
  method: "patch",
  path: `${base}/{endpointId}`,
  operationId: "updateWebhookEndpoint",
  "x-cohory": routeMeta("updateWebhookEndpoint"),
  tags,
  security,
  summary: "Change a webhook endpoint",
  description: `Changes the URL, the description, or the events.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: endpointParams, ...jsonBody(updateBodySchema) },
  responses: { 200: json(endpointSchema, "The endpoint."), 409: conflict, ...errors },
});

const deleteEndpoint = createRoute({
  method: "delete",
  path: `${base}/{endpointId}`,
  operationId: "deleteWebhookEndpoint",
  "x-cohory": routeMeta("deleteWebhookEndpoint"),
  tags,
  security,
  summary: "Delete a webhook endpoint",
  description: `Deletes the endpoint and its delivery log.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: endpointParams },
  responses: { 204: { description: "Deleted." }, ...errors },
});

function actionRoute<R extends Record<number, ReturnType<typeof json>>>(
  action: "rotate-secret" | "disable" | "enable" | "test",
  operationId: OperationId,
  summary: string,
  description: string,
  responses: R,
) {
  return createRoute({
    method: "post",
    path: `${base}/{endpointId}/${action}`,
    operationId,
    "x-cohory": routeMeta(operationId),
    tags,
    security,
    summary,
    description: `${description}${managers}`,
    middleware: [writeLimit] as const,
    request: { params: endpointParams },
    responses: { ...responses, 409: conflict, ...errors },
  });
}

const rotateSecret = createRoute({
  method: "post",
  path: `${base}/{endpointId}/rotate-secret`,
  operationId: "rotateWebhookSecret",
  "x-cohory": routeMeta("rotateWebhookSecret"),
  tags,
  security,
  summary: "Rotate the signing secret",
  description: `Creates a new secret and returns it once. Deliveries from now on are signed with it. With keepPrevious, deliveries carry a second signature made with the old secret for 24 hours; otherwise the old secret stops working right away.${managers}`,
  middleware: [writeLimit] as const,
  request: {
    params: endpointParams,
    body: { required: false, content: { "application/json": { schema: rotateBodySchema } } },
  },
  responses: {
    200: json(endpointWithSecretSchema, "The endpoint and its new secret."),
    409: conflict,
    ...errors,
  },
});
const disableEndpoint = actionRoute(
  "disable",
  "disableWebhookEndpoint",
  "Turn off a webhook endpoint",
  "Stops deliveries. Deliveries still waiting are marked failed and are not sent later.",
  { 200: json(endpointSchema, "The endpoint.") },
);
const enableEndpoint = actionRoute(
  "enable",
  "enableWebhookEndpoint",
  "Turn on a webhook endpoint",
  "Starts deliveries again for new events and clears the failure counters.",
  { 200: json(endpointSchema, "The endpoint.") },
);
const sendTest = actionRoute(
  "test",
  "sendWebhookTestEvent",
  "Send a test event",
  "Queues a signed webhook.test event to the endpoint. Its result appears in the delivery log.",
  { 202: json(deliverySchema, "The queued test delivery.") },
);

const listDeliveries = createRoute({
  method: "get",
  path: `${base}/{endpointId}/deliveries`,
  operationId: "listWebhookDeliveries",
  "x-cohory": routeMeta("listWebhookDeliveries"),
  tags,
  security,
  summary: "List webhook deliveries",
  description: `Delivery log of an endpoint, newest first, with the status of each attempt.${managers}`,
  request: { params: endpointParams, query: deliveriesQuerySchema },
  responses: {
    200: json(page(deliverySchema, "WebhookDeliveryPage"), "The deliveries."),
    ...errors,
  },
});

const getDelivery = createRoute({
  method: "get",
  path: `${base}/{endpointId}/deliveries/{deliveryId}`,
  operationId: "getWebhookDelivery",
  "x-cohory": routeMeta("getWebhookDelivery"),
  tags,
  security,
  summary: "Get a webhook delivery",
  description: `One delivery with its payload and each attempt: the request headers and body, the response status, and the start of the response body.${managers}`,
  request: { params: deliveryParams },
  responses: { 200: json(deliveryDetailSchema, "The delivery and its attempts."), ...errors },
});

const resendDelivery = createRoute({
  method: "post",
  path: `${base}/{endpointId}/deliveries/{deliveryId}/resend`,
  operationId: "resendWebhookDelivery",
  "x-cohory": routeMeta("resendWebhookDelivery"),
  tags,
  security,
  summary: "Resend a webhook delivery",
  description: `Sends the delivery again now with the same webhook-id. A finished delivery starts a new retry schedule; one that is waiting for a retry is sent now.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: deliveryParams },
  responses: { 202: json(deliverySchema, "The queued delivery."), 409: conflict, ...errors },
});

const resendFailed = createRoute({
  method: "post",
  path: `${base}/{endpointId}/resend-failed`,
  operationId: "resendFailedWebhookDeliveries",
  "x-cohory": routeMeta("resendFailedWebhookDeliveries"),
  tags,
  security,
  summary: "Resend failed webhook deliveries",
  description: `Sends every failed delivery created since a time again, oldest first, up to ${maxResendBatch} per call. Use it after turning an endpoint back on.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: endpointParams, ...jsonBody(resendFailedBodySchema) },
  responses: {
    202: json(z.object({ resent: z.int().min(0) }), "How many deliveries were queued."),
    409: conflict,
    ...errors,
  },
});

export function createWebhooksRoutes(getDeps: () => WebhooksRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/manage/webhooks", actor);
  app.use("/communities/:slug/manage/webhooks/*", actor);

  const webhooks = () => getDeps().webhooks;
  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listEndpoints, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const data = await webhooks().listEndpoints(caller, id);
      return c.json({ data: data.map(endpointJson), nextCursor: null }, 200);
    })
    .openapi(createEndpoint, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const created = await webhooks().createEndpoint(caller, id, c.req.valid("json"));
      return c.json({ endpoint: endpointJson(created.endpoint), secret: created.secret }, 201);
    })
    .openapi(getEndpoint, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(endpointJson(await webhooks().getEndpoint(caller, id, endpointId)), 200);
    })
    .openapi(updateEndpoint, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const view = await webhooks().updateEndpoint(caller, id, endpointId, c.req.valid("json"));
      return c.json(endpointJson(view), 200);
    })
    .openapi(deleteEndpoint, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      await webhooks().deleteEndpoint(caller, id, endpointId);
      return c.body(null, 204);
    })
    .openapi(rotateSecret, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const body = c.req.valid("json");
      const rotated = await webhooks().rotateSecret(caller, id, endpointId, {
        keepPrevious: body?.keepPrevious ?? false,
      });
      return c.json({ endpoint: endpointJson(rotated.endpoint), secret: rotated.secret }, 200);
    })
    .openapi(disableEndpoint, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(endpointJson(await webhooks().disableEndpoint(caller, id, endpointId)), 200);
    })
    .openapi(enableEndpoint, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(endpointJson(await webhooks().enableEndpoint(caller, id, endpointId)), 200);
    })
    .openapi(sendTest, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(deliveryJson(await webhooks().sendTestEvent(caller, id, endpointId)), 202);
    })
    .openapi(listDeliveries, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const result = await webhooks().listDeliveries(caller, id, endpointId, c.req.valid("query"));
      return c.json({ data: result.data.map(deliveryJson), nextCursor: result.nextCursor }, 200);
    })
    .openapi(getDelivery, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId, deliveryId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const detail = await webhooks().getDelivery(caller, id, endpointId, deliveryId);
      return c.json(deliveryDetailJson(detail), 200);
    })
    .openapi(resendDelivery, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId, deliveryId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const view = await webhooks().resendDelivery(caller, id, endpointId, deliveryId);
      return c.json(deliveryJson(view), 202);
    })
    .openapi(resendFailed, async (c) => {
      const caller = c.get("actor");
      const { slug, endpointId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const result = await webhooks().resendFailedDeliveries(
        caller,
        id,
        endpointId,
        c.req.valid("json"),
      );
      return c.json(result, 202);
    });
}
