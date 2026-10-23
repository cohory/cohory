import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ProviderRejectedError } from "../../errors";
import { WebhookSignatureError } from "../../stripe-gateway";
import type { Connection } from "../types";
import { createPolarProvider, polarTestEventType } from "./adapter";
import { polarProductionUrl, polarSandboxUrl } from "./client";
import { signStandardWebhook } from "./webhook";

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null) throw new Error(name);
  return parsed as Json;
}

const order = fixture("order");
const subscription = fixture("subscription");
const communityId = "0199f000-0000-7000-8000-000000000001";
const buyerId = "0199f000-0000-7000-8000-0000000000b1";
const secret = `whsec_${Buffer.from("polar fixture key").toString("base64")}`;
const now = new Date("2026-10-19T10:06:30.000Z");

const conn: Connection = {
  id: "0199f000-0000-7000-8000-0000000000c1",
  communityId,
  provider: "polar",
  externalAccountId: "8f2b7c1e-1d2a-4c55-9a0e-5b8f0c7d1a01",
  livemode: false,
  apiCredential: "polar_oat_fixture_token",
  webhookSecret: secret,
};

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly auth: string | null;
  readonly body: Json | null;
}

function fakeApi(routes: Record<string, () => { status?: number; body: unknown }>) {
  const requests: Recorded[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : null;
    requests.push({ method, url, auth: headers.get("authorization"), body });
    const path = new URL(url).pathname;
    const route = routes[`${method} ${path}`];
    if (!route) {
      return Response.json({ error: "ResourceNotFound" }, { status: 404 });
    }
    const { status = 200, body: payload } = route();
    return Response.json(payload, { status });
  };
  return { requests, fetchStub };
}

function provider(routes: Record<string, () => { status?: number; body: unknown }> = {}) {
  const api = fakeApi(routes);
  return {
    ...api,
    polar: createPolarProvider({ apiBaseUrl: null, fetch: api.fetchStub, now: () => now }),
  };
}

function signed(type: string, data: Json, at = now) {
  const rawBody = JSON.stringify({ type, timestamp: at.toISOString(), data });
  const headers = signStandardWebhook(secret, "msg_fixture", at, rawBody);
  return { rawBody, header: (name: string) => headers[name] ?? null };
}

describe("Polar adapter", () => {
  it("reports no fee split, a portal, and refunds in its capability record", () => {
    const { polar } = provider();
    expect(polar.capabilities(conn)).toMatchObject({
      supportsFeeSplit: false,
      supportsCustomerPortal: true,
      supportsRefundApi: true,
      supportsHostedCheckout: true,
    });
    expect(polar.platformFees).toBeUndefined();
    expect(polar.setPlatformFee).toBeUndefined();
  });

  it("is connected with an access token and expects events in the mode of its server", () => {
    const { polar } = provider();
    expect(polar.setup).toBe("access_token");
    expect(polar.platformWebhooks).toBeUndefined();
    expect(polar.hostedOnboarding).toBeUndefined();
    expect(polar.expectsLiveEvents(conn)).toBe(false);
    expect(polar.expectsLiveEvents({ ...conn, livemode: true })).toBe(true);
  });

  it("verifies a signed delivery and uses the webhook id as the event id", () => {
    const { polar } = provider();
    const event = polar.verifyWebhook(signed("order.paid", order), conn);
    expect(event).toMatchObject({
      id: "msg_fixture",
      type: "order.paid",
      account: null,
      livemode: false,
    });
    expect(event.object.id).toBe(order["id"]);
  });

  it("refuses a delivery without a saved secret or with a stale timestamp", () => {
    const { polar } = provider();
    expect(() => polar.verifyWebhook(signed("order.paid", order), null)).toThrow(
      WebhookSignatureError,
    );
    const stale = signed("order.paid", order, new Date(now.getTime() - 10 * 60_000));
    expect(() => polar.verifyWebhook(stale, conn)).toThrow(WebhookSignatureError);
  });

  it("fetches the current order and normalizes a paid order", async () => {
    const { polar, requests } = provider({
      [`GET /v1/orders/${String(order["id"])}`]: () => ({ body: order }),
    });
    const events = await polar.normalizeEvent(
      polar.verifyWebhook(signed("order.paid", { id: String(order["id"]) }), conn),
      conn,
    );
    expect(events).toEqual([
      { kind: "subscription_changed", subscriptionId: subscription["id"] },
      {
        kind: "payment_succeeded",
        payment: {
          externalId: order["id"],
          subscriptionId: subscription["id"],
          paymentRef: order["id"],
          currency: "usd",
          amountMinor: 3190,
          taxMinor: 290,
          paidAt: new Date("2026-10-19T10:06:05Z"),
        },
      },
    ]);
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: `${polarSandboxUrl}/v1/orders/${String(order["id"])}`,
      auth: "Bearer polar_oat_fixture_token",
    });
  });

  it("normalizes a refunded order with the pre tax amounts for the fee", async () => {
    const refunded = {
      ...order,
      status: "partially_refunded",
      refunded_amount: 1450,
      refunded_tax_amount: 145,
    };
    const { polar } = provider({
      [`GET /v1/orders/${String(order["id"])}`]: () => ({ body: refunded }),
    });
    const events = await polar.normalizeEvent(
      polar.verifyWebhook(signed("order.refunded", { id: String(order["id"]) }), conn),
      conn,
    );
    expect(events).toEqual([
      {
        kind: "payment_refunded",
        refund: {
          chargeRef: order["id"],
          paymentRef: order["id"],
          chargedMinor: 2900,
          refundedMinor: 1450,
          paymentRefundedMinor: 1595,
          platformFeeId: null,
        },
      },
    ]);
  });

  it("maps subscription events, a finished checkout, and the test event", async () => {
    const { polar } = provider();
    const id = String(subscription["id"]);
    expect(
      await polar.normalizeEvent(
        polar.verifyWebhook(signed("subscription.canceled", subscription), conn),
        conn,
      ),
    ).toEqual([{ kind: "subscription_changed", subscriptionId: id }]);
    const checkout = {
      ...fixture("checkout"),
      status: "succeeded",
      subscription_id: id,
      metadata: { cohory_community_id: communityId, cohory_user_id: buyerId },
    };
    expect(
      await polar.normalizeEvent(
        polar.verifyWebhook(signed("checkout.updated", checkout), conn),
        conn,
      ),
    ).toEqual([{ kind: "checkout_completed", subscriptionId: id, userIdHint: buyerId }]);
    expect(
      await polar.normalizeEvent(
        polar.verifyWebhook(signed(polarTestEventType, { id: "cohory_test_1" }), conn),
        conn,
      ),
    ).toEqual([]);
    expect(
      await polar.normalizeEvent(
        polar.verifyWebhook(signed("benefit.created", { id: "b" }), conn),
        conn,
      ),
    ).toBeNull();
  });

  it("reads a subscription into the mirror shape", async () => {
    const id = String(subscription["id"]);
    const { polar } = provider({ [`GET /v1/subscriptions/${id}`]: () => ({ body: subscription }) });
    expect(await polar.getSubscription(id, conn)).toEqual({
      id,
      status: "active",
      customerId: subscription["customer_id"],
      metadata: subscription["metadata"],
      currentPeriodEnd: new Date("2026-11-19T10:06:00Z"),
      cancelAtPeriodEnd: false,
      endedAt: null,
      interval: "month",
      applicationFeePercent: null,
      priceId: subscription["product_id"],
    });
  });

  it("reads the organization as the account state", async () => {
    const { polar } = provider({
      "GET /v1/organizations/": () => ({
        body: { items: [fixture("organization")], pagination: {} },
      }),
    });
    expect(await polar.getAccountState(conn)).toEqual({
      id: "8f2b7c1e-1d2a-4c55-9a0e-5b8f0c7d1a01",
      chargesEnabled: true,
      detailsSubmitted: true,
      livemode: false,
      country: null,
    });
  });

  it("creates one product per interval and reuses products found by plan metadata", async () => {
    const monthly = fixture("product");
    const yearly = { ...monthly, id: "product-year", recurring_interval: "year" };
    let listed = 0;
    const { polar, requests } = provider({
      "GET /v1/products/": () => {
        listed += 1;
        return { body: { items: listed === 1 ? [monthly] : [], pagination: {} } };
      },
      "POST /v1/products/": () => ({ status: 201, body: yearly }),
    });
    const provisioned = await polar.provisionPlan(
      {
        planId: "plan-1",
        communityId,
        name: "Membership",
        currency: "usd",
        monthlyPriceMinor: 2900,
        annualPriceMinor: 29_000,
        imageUrl: null,
        productId: null,
        monthlyPriceId: null,
        annualPriceId: null,
      },
      conn,
    );
    expect(provisioned).toEqual({
      productId: monthly["id"],
      monthlyPriceId: monthly["id"],
      annualPriceId: "product-year",
    });
    const created = requests.find((request) => request.method === "POST");
    expect(created?.body).toEqual({
      name: "Membership (yearly)",
      recurring_interval: "year",
      prices: [{ amount_type: "fixed", price_amount: 29_000, price_currency: "usd" }],
      metadata: {
        cohory_community_id: communityId,
        cohory_plan_id: "plan-1",
        cohory_interval: "year",
      },
    });
    expect(requests[0]?.url).toContain("metadata%5Bcohory_plan_id%5D=plan-1");
  });

  it("opens a hosted checkout with the Polar placeholder and the buyer as external customer", async () => {
    const { polar, requests } = provider({
      "POST /v1/checkouts/": () => ({ status: 201, body: fixture("checkout") }),
    });
    const result = await polar.createCheckout(
      {
        priceId: "product-month",
        customerId: null,
        customerEmail: "buyer@example.test",
        clientReferenceId: buyerId,
        metadata: { cohory_community_id: communityId, cohory_user_id: buyerId },
        platformFeeBps: 200,
        trialEnd: null,
        expiresAt: new Date("2026-10-23T00:00:00Z"),
        submitMessage: null,
        successUrl: "http://localhost:3000/c/paid/membership?checkout=success",
        cancelUrl: "http://localhost:3000/c/paid/membership?checkout=cancel",
        idempotencyKey: "checkout:1",
      },
      conn,
    );
    expect(result).toEqual({
      url: "https://sandbox.polar.sh/checkout/polar_c_fixture",
      externalId: "4b3a2918-7f6e-4d5c-8b4a-392817160501",
    });
    expect(requests[0]?.body).toEqual({
      products: ["product-month"],
      success_url:
        "http://localhost:3000/c/paid/membership?checkout=success&checkout_id={CHECKOUT_ID}",
      return_url: "http://localhost:3000/c/paid/membership?checkout=cancel",
      metadata: { cohory_community_id: communityId, cohory_user_id: buyerId },
      allow_trial: false,
      external_customer_id: buyerId,
      customer_email: "buyer@example.test",
    });
  });

  it("opens the customer portal, cancels, revokes, and refunds through the documented routes", async () => {
    const id = String(subscription["id"]);
    const { polar, requests } = provider({
      "POST /v1/customer-sessions/": () => ({ status: 201, body: fixture("customer-session") }),
      [`PATCH /v1/subscriptions/${id}`]: () => ({
        body: { ...subscription, cancel_at_period_end: true },
      }),
      [`GET /v1/orders/${String(order["id"])}`]: () => ({ body: order }),
      "POST /v1/refunds/": () => ({ status: 201, body: fixture("refund") }),
    });
    const portal = await polar.createPortalSession(
      "cust-1",
      "http://localhost:3000/c/paid/membership",
      "portal:1",
      conn,
    );
    expect(portal.url).toContain("customer_session_token=polar_cst_fixture");
    await polar.cancelSubscription(id, { atPeriodEnd: true, idempotencyKey: "c1" }, conn);
    await polar.cancelSubscription(id, { atPeriodEnd: false, idempotencyKey: "c2" }, conn);
    const refund = await polar.refund(String(order["id"]), "full", "refund:1", conn);
    expect(refund).toEqual({
      id: "1b2c3d4e-5f60-4718-89a0-b1c2d3e4f501",
      amountMinor: 2900,
      currency: "usd",
      status: "succeeded",
    });
    expect(requests.map((request) => request.body)).toEqual([
      { customer_id: "cust-1", return_url: "http://localhost:3000/c/paid/membership" },
      { cancel_at_period_end: true },
      { revoke: true },
      null,
      {
        order_id: order["id"],
        reason: "customer_request",
        amount: 2900,
        metadata: { cohory_idempotency_key: "refund:1" },
      },
    ]);
  });

  it("turns an API error into a provider rejection and uses production only for live connections", async () => {
    const { polar, requests } = provider({
      "GET /v1/organizations/": () => ({ status: 401, body: { error: "Unauthorized" } }),
    });
    const rejected = polar.getAccountState({ ...conn, livemode: true });
    await expect(rejected).rejects.toThrow(ProviderRejectedError);
    await expect(rejected).rejects.toMatchObject({ status: 401, providerCode: "Unauthorized" });
    expect(requests[0]?.url.startsWith(polarProductionUrl)).toBe(true);
  });

  it("signs a test event that its own verifier accepts", () => {
    const { polar } = provider();
    const test = polar.signTestEvent?.(conn, "cohory_test_2", now);
    if (!test) throw new Error("no test event");
    const event = polar.verifyWebhook(
      { rawBody: test.rawBody, header: (name) => test.headers[name] ?? null },
      conn,
    );
    expect(event).toMatchObject({ id: "cohory_test_2", type: polarTestEventType });
  });
});
