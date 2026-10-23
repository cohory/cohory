import { createRoute } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor } from "../middleware/session";
import type { PaymentsRouteDeps } from "./payments";
import {
  discoverQuerySchema,
  discoveryJson,
  linkResultJson,
  linkResultSchema,
  linkSubscribersBodySchema,
  subscriberDiscoverySchema,
  subscriptionLinkListJson,
  subscriptionLinkListSchema,
} from "./payments-linking-schemas";
import { communityIdParams } from "./payments-schemas";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

const security = [{ sessionCookie: [] }];
const tags = ["Payments"];
const base = "/communities/{communityId}/payments/subscribers";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community does not exist."),
  409: errorResponse("The community has no Stripe connection that can take payments."),
  422: errorResponse("The input is invalid."),
  503: errorResponse("Payments are not configured on this server."),
};
const managers = " Admins and owners only.";

const discover = createRoute({
  method: "get",
  path: base,
  operationId: "discoverSubscribers",
  "x-cohory": routeMeta("discoverSubscribers"),
  tags,
  security,
  summary: "List existing Stripe subscriptions to bring over",
  description: `One page of the active, trial, and past due subscriptions on the connected Stripe account, matched to people by the customer email (on the Cloud Edition only to members of the community). Each row carries the proposed action, the actions that are allowed, and a suggested billing period, so this is the list and the preview in one. Pass nextCursor as cursor for the next page.${managers}`,
  request: { params: communityIdParams, query: discoverQuerySchema },
  responses: { 200: json(subscriberDiscoverySchema, "One page of subscriptions."), ...errors },
});

const listLinks = createRoute({
  method: "get",
  path: `${base}/links`,
  operationId: "listSubscriptionLinks",
  "x-cohory": routeMeta("listSubscriptionLinks"),
  tags,
  security,
  summary: "List linked and invited subscriptions",
  description: `The migration ledger: every Stripe subscription that was linked to a member or is waiting for the invited person to sign up, newest first, up to 200.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(subscriptionLinkListSchema, "Subscription links."), ...errors },
});

const link = createRoute({
  method: "post",
  path: `${base}/link`,
  operationId: "linkSubscribers",
  "x-cohory": routeMeta("linkSubscribers"),
  tags,
  security,
  summary: "Link existing Stripe subscriptions to members",
  description: `Fetches each subscription from Stripe again, matches it again, and links it, adds the person as a member, or records an invite by email. On the Cloud Edition, people outside the community are never matched by email and link_and_add records an invite they claim by signing in. Up to 100 rows per call; each row needs a billing period unless it is skipped. The response says what happened to each row. This route does not send the "Your membership has moved" email: notify the addresses in invitedEmails yourself.${managers}`,
  middleware: [writeLimit] as const,
  request: {
    params: communityIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: linkSubscribersBodySchema } },
    },
  },
  responses: { 200: json(linkResultSchema, "The outcome per row."), ...errors },
});

export function createPaymentsLinkingRoutes(getDeps: () => PaymentsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:communityId/payments/subscribers", actor);
  app.use("/communities/:communityId/payments/subscribers/*", actor);

  const payments = () => getDeps().payments;

  return app
    .openapi(discover, async (c) => {
      const query = c.req.valid("query");
      const discovery = await payments().discoverSubscriptions(
        c.get("actor"),
        c.req.valid("param").communityId,
        {
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        },
      );
      return c.json(discoveryJson(discovery), 200);
    })
    .openapi(listLinks, async (c) => {
      const links = await payments().listSubscriptionLinks(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(subscriptionLinkListJson(links), 200);
    })
    .openapi(link, async (c) => {
      const body = c.req.valid("json");
      const result = await payments().linkSubscriptions(
        c.get("actor"),
        c.req.valid("param").communityId,
        {
          rows: body.rows,
          ...(body.addPlatformFee === undefined ? {} : { addPlatformFee: body.addPlatformFee }),
        },
      );
      return c.json(linkResultJson(result), 200);
    });
}
