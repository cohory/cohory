import type { z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { type PaymentsService } from "@cohory/payments";
import { bodyLimit } from "hono/body-limit";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import {
  checkoutBodySchema,
  communityIdParams,
  connectBodySchema,
  connectionJson,
  connectionSchema,
  connectResponseSchema,
  disconnectBodySchema,
  exitRunJson,
  exitRunSchema,
  ledgerSummaryJson,
  ledgerSummarySchema,
  myMembershipJson,
  myMembershipSchema,
  overviewJson,
  overviewSchema,
  ownershipReviewJson,
  ownershipReviewSchema,
  ownKeysBodySchema,
  paidMembersJson,
  paidMembersSchema,
  planJson,
  planResponseSchema,
  planSchema,
  redirectSchema,
  subscriptionListJson,
  subscriptionListSchema,
  upsertPlanBodySchema,
} from "./payments-schemas";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface PaymentsRouteDeps {
  resolveSession: SessionResolver;
  payments: PaymentsService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Payments"];
const base = "/communities/{communityId}/payments";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community or payment object does not exist."),
  409: errorResponse("The community is not in a state that allows this."),
  422: errorResponse("The input is invalid."),
  503: errorResponse("Payments are not configured on this server."),
};
const ownerOnly = " Owner only.";
const managers = " Admins and owners only.";

function jsonBody<T extends z.ZodType>(schema: T, required = true) {
  return { body: { required, content: { "application/json": { schema } } } };
}

const overview = createRoute({
  method: "get",
  path: base,
  operationId: "getPaymentsOverview",
  "x-cohory": routeMeta("getPaymentsOverview"),
  tags,
  security,
  summary: "Get the payment setup of a community",
  description: `Edition, platform fee in basis points, the providers this server offers, and the current connection.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(overviewSchema, "The payment setup."), ...errors },
});

const connect = createRoute({
  method: "post",
  path: `${base}/connect`,
  operationId: "connectStripe",
  "x-cohory": routeMeta("connectStripe"),
  tags,
  security,
  summary: "Connect your Stripe account",
  description: `Cloud only. Creates the creator's connected account on first use and returns a single use Stripe onboarding link.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams, ...jsonBody(connectBodySchema, false) },
  responses: { 200: json(connectResponseSchema, "Where to send the owner."), ...errors },
});

const ownKeys = createRoute({
  method: "post",
  path: `${base}/own-keys`,
  operationId: "connectOwnStripeKeys",
  "x-cohory": routeMeta("connectOwnStripeKeys"),
  tags,
  security,
  summary: "Connect Stripe with your own keys",
  description: `Community Edition only. Stores a secret or restricted key and a webhook signing secret, encrypted. Register the returned webhook path in Stripe.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams, ...jsonBody(ownKeysBodySchema) },
  responses: { 200: json(connectionSchema, "The new connection."), ...errors },
});

const refresh = createRoute({
  method: "post",
  path: `${base}/refresh`,
  operationId: "refreshPaymentConnection",
  "x-cohory": routeMeta("refreshPaymentConnection"),
  tags,
  security,
  summary: "Refresh the Stripe account status",
  description: `Reads charges enabled and onboarding state from Stripe.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 200: json(connectionSchema, "The updated connection."), ...errors },
});

const disconnect = createRoute({
  method: "post",
  path: `${base}/disconnect`,
  operationId: "disconnectStripe",
  "x-cohory": routeMeta("disconnectStripe"),
  tags,
  security,
  summary: "Disconnect the payment account",
  description: `Starts a disconnect in a fixed order: removes the platform fee from every subscription and checks it, applies the member choice (take_members keeps billing, wind_down ends each subscription at its period end), and only then closes the connection and archives the plan. Checkouts stay closed while the connection is disconnecting. The response is the connection as it is now, disconnecting or already disconnected.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams, ...jsonBody(disconnectBodySchema, false) },
  responses: { 200: json(connectionSchema, "The connection."), ...errors },
});

const forceDisconnect = createRoute({
  method: "post",
  path: `${base}/disconnect/force`,
  operationId: "forceDisconnectStripe",
  "x-cohory": routeMeta("forceDisconnectStripe"),
  tags,
  security,
  summary: "Disconnect anyway after a failed disconnect",
  description: `Only after the latest disconnect run failed. Closes the connection although some subscriptions may still carry the platform fee; the owner is told how to clear it in the Stripe Dashboard and fees received afterwards are refunded.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 200: json(connectionSchema, "The closed connection."), ...errors },
});

const retryExit = createRoute({
  method: "post",
  path: `${base}/exit/retry`,
  operationId: "retryPaidMembersChange",
  "x-cohory": routeMeta("retryPaidMembersChange"),
  tags,
  security,
  summary: "Retry the latest failed change to paid members",
  description: `Runs the latest failed archive or disconnect run again from the start.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 200: json(exitRunSchema, "The run."), ...errors },
});

const ownershipReview = createRoute({
  method: "get",
  path: `${base}/ownership-review`,
  operationId: "getPaymentOwnershipReview",
  "x-cohory": routeMeta("getPaymentOwnershipReview"),
  tags,
  security,
  summary: "Check whether a new owner must choose a payment account",
  description: `After an ownership transfer, new checkouts pause until the new owner keeps the previous owner's account or disconnects it and connects their own. The review is null when there is nothing to choose.${ownerOnly}`,
  request: { params: communityIdParams },
  responses: { 200: json(ownershipReviewSchema, "The review."), ...errors },
});

const keepAccount = createRoute({
  method: "post",
  path: `${base}/keep-account`,
  operationId: "keepPaymentAccount",
  "x-cohory": routeMeta("keepPaymentAccount"),
  tags,
  security,
  summary: "Keep the previous owner's payment account",
  description: `The previous owner's Stripe account keeps receiving payments, with the platform fee unchanged, and checkouts resume.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 200: json(connectionSchema, "The kept connection."), ...errors },
});

const getPlan = createRoute({
  method: "get",
  path: `${base}/plan`,
  operationId: "getMembershipPlan",
  "x-cohory": routeMeta("getMembershipPlan"),
  tags,
  security,
  summary: "Get the paid membership plan",
  description: "Public price information. The plan is null when the community is free.",
  request: { params: communityIdParams },
  responses: { 200: json(planResponseSchema, "The active plan."), ...errors },
});

const upsertPlan = createRoute({
  method: "put",
  path: `${base}/plan`,
  operationId: "upsertMembershipPlan",
  "x-cohory": routeMeta("upsertMembershipPlan"),
  tags,
  security,
  summary: "Set the paid membership plan",
  description: `Monthly price, optional annual price, and one currency per community. A price change creates a new plan version so existing subscribers keep their price.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams, ...jsonBody(upsertPlanBodySchema) },
  responses: { 200: json(planSchema, "The active plan."), ...errors },
});

const archivePlan = createRoute({
  method: "delete",
  path: `${base}/plan`,
  operationId: "archiveMembershipPlan",
  "x-cohory": routeMeta("archiveMembershipPlan"),
  tags,
  security,
  summary: "Stop selling the paid membership",
  description: `The community becomes free to join. Existing Stripe subscriptions keep running on the creator's account.${ownerOnly}`,
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 204: { description: "The plan is archived." }, ...errors },
});

const checkout = createRoute({
  method: "post",
  path: `${base}/checkout`,
  operationId: "createMembershipCheckout",
  "x-cohory": routeMeta("createMembershipCheckout"),
  tags,
  security,
  summary: "Start Stripe Checkout for the paid membership",
  description:
    "Returns a Stripe hosted Checkout URL. Access is granted when the webhook confirms the subscription, not on redirect.",
  middleware: [writeLimit] as const,
  request: { params: communityIdParams, ...jsonBody(checkoutBodySchema, false) },
  responses: { 200: json(redirectSchema, "Where to send the buyer."), ...errors },
});

const portal = createRoute({
  method: "post",
  path: `${base}/portal`,
  operationId: "createBillingPortalSession",
  "x-cohory": routeMeta("createBillingPortalSession"),
  tags,
  security,
  summary: "Open the Stripe customer portal",
  description:
    "Members manage their payment method and cancel there. Cancellation takes effect at period end.",
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: { 200: json(redirectSchema, "Where to send the member."), ...errors },
});

const me = createRoute({
  method: "get",
  path: `${base}/me`,
  operationId: "getMyPaidMembership",
  "x-cohory": routeMeta("getMyPaidMembership"),
  tags,
  security,
  summary: "Get the caller's paid membership",
  description: "Access level, plan, subscription state, and whether the portal is available.",
  request: { params: communityIdParams },
  responses: { 200: json(myMembershipSchema, "The caller's membership."), ...errors },
});

const subscriptionList = createRoute({
  method: "get",
  path: `${base}/subscriptions`,
  operationId: "listSubscriptions",
  "x-cohory": routeMeta("listSubscriptions"),
  tags,
  security,
  summary: "List subscriptions",
  description: `Newest first, up to 500.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(subscriptionListSchema, "Subscriptions."), ...errors },
});

const ledger = createRoute({
  method: "get",
  path: `${base}/ledger`,
  operationId: "getPaymentsLedgerSummary",
  "x-cohory": routeMeta("getPaymentsLedgerSummary"),
  tags,
  security,
  summary: "Summarize payments and platform fees",
  description: `Gross, refunds, tax, and platform fees per currency. Currencies are never summed together.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(ledgerSummarySchema, "Totals per currency."), ...errors },
});

const paidMembers = createRoute({
  method: "get",
  path: `${base}/paid-members`,
  operationId: "getPaidMembersSummary",
  "x-cohory": routeMeta("getPaidMembersSummary"),
  tags,
  security,
  summary: "Count paying members before an exit",
  description: `Paying members who joined through Cohory, subscriptions linked from before Cohory, subscriptions set to end, and the latest change to paid members.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(paidMembersSchema, "Paying members."), ...errors },
});

export function createPaymentsRoutes(getDeps: () => PaymentsRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:communityId/payments/*",
    resolveActor(() => getDeps().resolveSession),
  );
  app.use(
    "/communities/:communityId/payments",
    resolveActor(() => getDeps().resolveSession),
  );

  const payments = () => getDeps().payments;

  return app
    .openapi(overview, async (c) => {
      const result = await payments().getPaymentsOverview(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(overviewJson(result), 200);
    })
    .openapi(connect, async (c) => {
      const body = c.req.valid("json");
      const result = await payments().connectStripe(
        c.get("actor"),
        c.req.valid("param").communityId,
        {
          email: body?.email ?? null,
          country: body?.country ?? null,
          acceptCreatorTerms: body?.acceptCreatorTerms ?? false,
        },
      );
      return c.json({ url: result.url, connection: connectionJson(result.connection) }, 200);
    })
    .openapi(ownKeys, async (c) => {
      const connection = await payments().connectOwnKeys(
        c.get("actor"),
        c.req.valid("param").communityId,
        c.req.valid("json"),
      );
      return c.json(connectionJson(connection), 200);
    })
    .openapi(refresh, async (c) => {
      const connection = await payments().refreshConnection(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(connectionJson(connection), 200);
    })
    .openapi(disconnect, async (c) => {
      const body = c.req.valid("json");
      const connection = await payments().disconnectStripe(
        c.get("actor"),
        c.req.valid("param").communityId,
        {
          ...(body?.memberChoice ? { memberChoice: body.memberChoice } : {}),
          ...(body?.includeLinked === undefined ? {} : { includeLinked: body.includeLinked }),
          ...(body?.portalLoginUrl ? { portalLoginUrl: body.portalLoginUrl } : {}),
        },
      );
      return c.json(connectionJson(connection), 200);
    })
    .openapi(forceDisconnect, async (c) => {
      const connection = await payments().forceDisconnect(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(connectionJson(connection), 200);
    })
    .openapi(retryExit, async (c) => {
      const run = await payments().retryExitRun(c.get("actor"), c.req.valid("param").communityId);
      return c.json(exitRunJson(run), 200);
    })
    .openapi(ownershipReview, async (c) => {
      const review = await payments().getOwnershipReview(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(ownershipReviewJson(review), 200);
    })
    .openapi(keepAccount, async (c) => {
      const connection = await payments().keepPaymentAccount(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(connectionJson(connection), 200);
    })
    .openapi(getPlan, async (c) => {
      const plan = await payments().getPlan(c.get("actor"), c.req.valid("param").communityId);
      return c.json({ plan: plan ? planJson(plan) : null }, 200);
    })
    .openapi(upsertPlan, async (c) => {
      const plan = await payments().upsertPlan(
        c.get("actor"),
        c.req.valid("param").communityId,
        c.req.valid("json"),
      );
      return c.json(planJson(plan), 200);
    })
    .openapi(archivePlan, async (c) => {
      await payments().archivePlan(c.get("actor"), c.req.valid("param").communityId);
      return c.body(null, 204);
    })
    .openapi(checkout, async (c) => {
      const body = c.req.valid("json");
      const result = await payments().createCheckoutSession(
        c.get("actor"),
        c.req.valid("param").communityId,
        {
          ...(body?.interval ? { interval: body.interval } : {}),
          ...(body?.answers ? { answers: body.answers } : {}),
        },
      );
      return c.json(result, 200);
    })
    .openapi(portal, async (c) => {
      const result = await payments().createPortalSession(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(result, 200);
    })
    .openapi(me, async (c) => {
      const view = await payments().getMyMembership(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(myMembershipJson(view), 200);
    })
    .openapi(subscriptionList, async (c) => {
      const list = await payments().listSubscriptions(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(subscriptionListJson(list), 200);
    })
    .openapi(paidMembers, async (c) => {
      const summary = await payments().getPaidMembersSummary(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(paidMembersJson(summary), 200);
    })
    .openapi(ledger, async (c) => {
      const summary = await payments().getLedgerSummary(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(ledgerSummaryJson(summary), 200);
    });
}
