import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { ApiBaseUrlRefusedError } from "./config";
import { withStripeServer } from "./test/stripe-server";
import {
  createStripeGateway,
  stripeApiVersion,
  stripeClientConfig,
  subscriptionOf,
  subscriptionSummaryOf,
  verifyStripeWebhook,
  WebhookSignatureError,
} from "./stripe-gateway";
import {
  recordedEvent,
  recordedEventTypes,
  recordedObject,
  withRecordedStripe,
} from "./test/fixtures/stripe";

const secret = "whsec_test_primary";
const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  account: "acct_123",
  livemode: false,
  created: 1_760_000_000,
  data: { object: { id: "sub_1", object: "subscription", status: "active" } },
});

function header(body: string, options: { secret?: string; timestamp?: number } = {}): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: options.secret ?? secret,
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
  });
}

describe("verifyStripeWebhook", () => {
  it("accepts a correctly signed event and keeps only what the handlers need", () => {
    const event = verifyStripeWebhook(payload, header(payload), [secret]);
    expect(event).toMatchObject({
      id: "evt_1",
      type: "customer.subscription.updated",
      account: "acct_123",
      livemode: false,
      object: { id: "sub_1" },
    });
  });

  it("tries every configured endpoint secret", () => {
    const signed = header(payload, { secret: "whsec_connect" });
    expect(verifyStripeWebhook(payload, signed, [secret, "whsec_connect"]).id).toBe("evt_1");
  });

  it("rejects a signature made with another secret", () => {
    expect(() =>
      verifyStripeWebhook(payload, header(payload, { secret: "whsec_other" }), [secret]),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a modified body", () => {
    const tampered = payload.replace("active", "canceled");
    expect(() => verifyStripeWebhook(tampered, header(payload), [secret])).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejects a stale timestamp", () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    expect(() =>
      verifyStripeWebhook(payload, header(payload, { timestamp: stale }), [secret]),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a missing header and an empty secret list", () => {
    expect(() => verifyStripeWebhook(payload, "", [secret])).toThrow(WebhookSignatureError);
    expect(() => verifyStripeWebhook(payload, header(payload), [])).toThrow(WebhookSignatureError);
  });

  it("rejects a signed payload that is not an event", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(() => verifyStripeWebhook(body, header(body), [secret])).toThrow();
  });
});

describe("stripeClientConfig", () => {
  it("talks to api.stripe.com unless a base URL override is set", () => {
    const base = { apiVersion: stripeApiVersion, maxNetworkRetries: 2, timeout: 20_000 };
    expect(stripeClientConfig()).toEqual(base);
    expect(stripeClientConfig({ apiBaseUrl: null })).toEqual(base);
  });

  it("pins the API version the installed SDK was built for", () => {
    expect(stripeApiVersion).toBe("2026-09-30.endive");
    expect(stripeApiVersion).toBe(Stripe.API_VERSION);
  });

  it("pins the version the recorded webhook endpoint events were sent with", () => {
    for (const type of recordedEventTypes) {
      expect(recordedEvent(type)["api_version"]).toBe(stripeApiVersion);
    }
  });

  it("refuses to send a live key to a base URL override", () => {
    expect(() =>
      createStripeGateway("sk_live_creator", { apiBaseUrl: "http://127.0.0.1:12111" }),
    ).toThrow(ApiBaseUrlRefusedError);
    expect(() =>
      createStripeGateway("rk_live_creator", { apiBaseUrl: "https://stripe-mock.internal" }),
    ).toThrow(ApiBaseUrlRefusedError);
    expect(() => createStripeGateway("sk_live_creator", { apiBaseUrl: null })).not.toThrow();
  });

  it("points the client at a test double from the override", () => {
    expect(stripeClientConfig({ apiBaseUrl: "http://127.0.0.1:12111" })).toMatchObject({
      host: "127.0.0.1",
      port: 12111,
      protocol: "http",
    });
    expect(stripeClientConfig({ apiBaseUrl: "https://stripe-mock.internal" })).toMatchObject({
      host: "stripe-mock.internal",
      port: 443,
      protocol: "https",
    });
  });
});

function stripeSubscription(overrides: Record<string, unknown>): Stripe.Subscription {
  const subscription = {
    id: "sub_1",
    object: "subscription",
    status: "active",
    customer: "cus_1",
    metadata: {},
    cancel_at: null,
    cancel_at_period_end: false,
    ended_at: null,
    application_fee_percent: 1,
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          current_period_end: 1_795_006_302,
          price: {
            id: "price_1",
            unit_amount: 2900,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...overrides,
  };
  const body = JSON.stringify({
    id: "evt_subscription",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: subscription },
  });
  const event = Stripe.webhooks.constructEvent(body, header(body), secret);
  if (event.type !== "customer.subscription.updated") {
    throw new Error(`Unexpected event type ${event.type}`);
  }
  return event.data.object;
}

describe("subscriptionOf", () => {
  it("treats a scheduled cancel_at as cancel at period end, which the portal sets since the flexible billing mode", () => {
    const scheduled = subscriptionOf(stripeSubscription({ cancel_at: 1_795_006_302 }));
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.currentPeriodEnd?.getTime()).toBe(1_795_006_302_000);

    const earlier = subscriptionOf(stripeSubscription({ cancel_at: 1_794_000_000 }));
    expect(earlier.currentPeriodEnd?.getTime()).toBe(1_794_000_000_000);
  });

  it("keeps the period end and the flag for a plain subscription and for a canceled one", () => {
    const plain = subscriptionOf(stripeSubscription({}));
    expect(plain.cancelAtPeriodEnd).toBe(false);
    expect(plain.currentPeriodEnd?.getTime()).toBe(1_795_006_302_000);

    const canceled = subscriptionOf(
      stripeSubscription({ status: "canceled", cancel_at: 1_795_006_302, ended_at: 1_792_328_107 }),
    );
    expect(canceled.cancelAtPeriodEnd).toBe(false);
    expect(canceled.endedAt?.getTime()).toBe(1_792_328_107_000);
  });
});

describe("subscriptionSummaryOf", () => {
  it("reads the customer email, the price, and the creating application for discovery", () => {
    const summary = subscriptionSummaryOf(
      stripeSubscription({
        currency: "usd",
        application: null,
        customer: { id: "cus_1", object: "customer", email: "Ada@Example.test", name: "Ada" },
      }),
    );
    expect(summary).toMatchObject({
      id: "sub_1",
      customerId: "cus_1",
      customerEmail: "Ada@Example.test",
      customerName: "Ada",
      priceId: "price_1",
      unitAmountMinor: 2900,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      createdByApplication: null,
    });
  });

  it("has no email for a deleted or unexpanded customer and names another platform", () => {
    const deleted = subscriptionSummaryOf(
      stripeSubscription({
        currency: "usd",
        application: "ca_other",
        customer: { id: "cus_1", object: "customer", deleted: true },
      }),
    );
    expect(deleted.customerEmail).toBeNull();
    expect(deleted.createdByApplication).toBe("ca_other");

    const plain = subscriptionSummaryOf(stripeSubscription({ currency: "usd", application: null }));
    expect(plain.customerEmail).toBeNull();
    expect(plain.customerId).toBe("cus_1");
  });
});

describe("createStripeGateway cancelSubscription", () => {
  it("cancels immediately without proration or a final invoice", async () => {
    const canceled = {
      ...stripeSubscription({ status: "canceled", ended_at: 1_792_328_107 }),
      object: "subscription",
    };
    await withStripeServer(canceled, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_cancel", { apiBaseUrl: baseUrl });
      const result = await gateway.cancelSubscription("acct_1", "sub_1", "exit:run:sub:cancel");
      expect(result.status).toBe("canceled");
      expect(captured).toHaveLength(1);
      const [request] = captured;
      expect(request?.method).toBe("DELETE");
      expect(request?.path).toContain("/v1/subscriptions/sub_1");
      const params = new URLSearchParams(request?.body ?? "");
      const query = new URLSearchParams((request?.path ?? "").split("?")[1] ?? "");
      const sent = (name: string) => params.get(name) ?? query.get(name);
      expect(sent("prorate")).toBe("false");
      expect(sent("invoice_now")).toBe("false");
      expect(request?.idempotencyKey).toBe("exit:run:sub:cancel");
      expect(request?.account).toBe("acct_1");
    });
  });
});

describe("createStripeGateway plans and checkout", () => {
  it("renames the product on the connected account", async () => {
    await withStripeServer({ id: "prod_1", object: "product" }, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_rename", { apiBaseUrl: baseUrl });
      await gateway.updateProduct("acct_1", "prod_1", { name: "Inner circle" }, "plan:p:rename:1");
      const [request] = captured;
      expect(request?.method).toBe("POST");
      expect(request?.path).toBe("/v1/products/prod_1");
      expect(new URLSearchParams(request?.body).get("name")).toBe("Inner circle");
      expect(request?.idempotencyKey).toBe("plan:p:rename:1");
      expect(request?.account).toBe("acct_1");
    });
  });

  it("expires only the member's other open sessions with a key per session", async () => {
    const metadata = { cohory_community_id: "c1", cohory_user_id: "u1" };
    const list = {
      object: "list",
      url: "/v1/checkout/sessions",
      has_more: false,
      data: [
        { id: "cs_old", object: "checkout.session", metadata },
        { id: "cs_keep", object: "checkout.session", metadata },
        {
          id: "cs_other",
          object: "checkout.session",
          metadata: { ...metadata, cohory_user_id: "u2" },
        },
      ],
    };
    await withStripeServer(list, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_expire", { apiBaseUrl: baseUrl });
      const expired = await gateway.expireOpenCheckoutSessions(
        "acct_1",
        { metadata, customerId: "cus_1", keepSessionId: "cs_keep" },
        "checkout-expire:cs_keep",
      );
      expect(expired).toEqual(["cs_old"]);
      const [listing, expiry] = captured;
      expect(listing?.path).toContain("/v1/checkout/sessions?");
      expect(listing?.path).toContain("status=open");
      expect(listing?.path).toContain("customer=cus_1");
      expect(expiry?.path).toBe("/v1/checkout/sessions/cs_old/expire");
      expect(expiry?.idempotencyKey).toBe("checkout-expire:cs_keep:cs_old");
      expect(captured.every((request) => request.account === "acct_1")).toBe(true);
      expect(captured).toHaveLength(2);
    });
  });

  it("lists the paid invoices of a subscription with their payments", async () => {
    const list = {
      object: "list",
      url: "/v1/invoices",
      has_more: false,
      data: [recordedObject("invoice")],
    };
    await withStripeServer(list, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_invoices", { apiBaseUrl: baseUrl });
      const invoices = await gateway.listPaidInvoices("acct_1", "sub_1UTCFjFx0CreatorCDM9LFsY");
      expect(invoices.map((invoice) => invoice.paymentIntentIds)).toEqual([
        ["pi_3UTCFkFx0Creator0lAkKLST"],
      ]);
      const query = new URLSearchParams(captured[0]?.path.split("?")[1]);
      expect(query.get("subscription")).toBe("sub_1UTCFjFx0CreatorCDM9LFsY");
      expect(query.get("status")).toBe("paid");
      expect(query.get("expand[0]")).toBe("data.payments");
    });
  });

  it("sends the pinned API version with every request", async () => {
    await withStripeServer({ id: "prod_1", object: "product" }, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_version", { apiBaseUrl: baseUrl });
      await gateway.updateProduct(null, "prod_1", { name: "Plan" }, "plan:p:rename:2");
      expect(captured[0]?.stripeVersion).toBe(stripeApiVersion);
    });
  });
});

describe("createStripeGateway disputes", () => {
  it("retrieves a dispute on the connected account and keeps what the handler needs", async () => {
    const dispute = {
      id: "dp_1",
      object: "dispute",
      amount: 2450,
      currency: "usd",
      charge: "ch_1",
      payment_intent: "pi_1",
      status: "needs_response",
      created: 1_792_900_000,
    };
    await withStripeServer(dispute, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_dispute", { apiBaseUrl: baseUrl });
      const result = await gateway.retrieveDispute("acct_1", "dp_1");
      expect(result).toEqual({
        id: "dp_1",
        chargeId: "ch_1",
        paymentIntentId: "pi_1",
        amount: 2450,
        currency: "usd",
        status: "needs_response",
        createdAt: new Date(1_792_900_000 * 1000),
      });
      expect(captured[0]?.path).toContain("/v1/disputes/dp_1");
      expect(captured[0]?.account).toBe("acct_1");
    });
  });

  it("tags a fee refund for a lost dispute with the dispute id", async () => {
    const refund = { id: "fr_1", object: "fee_refund", amount: 25, currency: "usd" };
    await withStripeServer(refund, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_fee", { apiBaseUrl: baseUrl });
      await gateway.refundApplicationFee("fee_1", 25, "fee-refund:dispute:dp_1", "dp_1");
      await gateway.refundApplicationFee("fee_1", 10, "fee-refund:ch_1:100", null);
      const [lost, plain] = captured.map((request) => new URLSearchParams(request.body));
      expect(captured[0]?.path).toContain("/v1/application_fees/fee_1/refunds");
      expect(captured[0]?.idempotencyKey).toBe("fee-refund:dispute:dp_1");
      expect(lost?.get("amount")).toBe("25");
      expect(lost?.get("metadata[cohory_dispute_id]")).toBe("dp_1");
      expect(plain?.has("metadata[cohory_dispute_id]")).toBe(false);
    });
  });
});

describe("createStripeGateway mappers on recorded test mode objects", () => {
  it("maps a paid invoice with its subscription, payment intent, and paid time", async () => {
    const invoice = recordedObject("invoice");
    const result = await withRecordedStripe([invoice], (gateway) =>
      gateway.retrieveInvoice("acct_recorded", invoice.id),
    );
    expect(result).toEqual({
      id: "in_1UTCFjFx0CreatorJhzvh5h4",
      subscriptionId: "sub_1UTCFjFx0CreatorCDM9LFsY",
      status: "paid",
      amountPaid: 4900,
      amountDue: 4900,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 0,
      currency: "gbp",
      paymentIntentIds: ["pi_3UTCFkFx0Creator0lAkKLST"],
      paidAt: new Date(1_792_638_075 * 1000),
    });
  });

  it("maps an invoice event object that carries no payments list", async () => {
    const invoice = recordedEvent("invoice.payment_failed").data.object;
    const result = await withRecordedStripe([invoice], (gateway) =>
      gateway.retrieveInvoice("acct_recorded", invoice.id),
    );
    expect(result).toMatchObject({
      subscriptionId: "sub_1UTCFrFx0CreatorcP1APQfk",
      status: "open",
      amountPaid: 0,
      amountDue: 4900,
      attemptCount: 1,
      paymentIntentIds: [],
      paidAt: null,
    });
  });

  it("maps a partly refunded charge with its application fee", async () => {
    const charge = recordedObject("charge");
    const result = await withRecordedStripe([charge], (gateway) =>
      gateway.retrieveCharge("acct_recorded", charge.id),
    );
    expect(result).toEqual({
      id: "ch_3UTCFkFx0Creator08vaUZIY",
      amount: 4900,
      amountRefunded: 1000,
      currency: "gbp",
      paymentIntentId: "pi_3UTCFkFx0Creator0lAkKLST",
      applicationFeeId: "fee_1UTCFkFx0CreatorOrT6zo3q",
    });
  });

  it("maps an application fee and its refunds", async () => {
    const fee = recordedObject("applicationFee");
    const result = await withRecordedStripe([fee], (gateway) =>
      gateway.retrieveApplicationFee(fee.id),
    );
    expect(result).toEqual({
      id: "fee_1UTCFkFx0CreatorOrT6zo3q",
      accountId: "acct_1Fake0Creator01",
      chargeId: "ch_3UTCFkFx0Creator08vaUZIY",
      amount: 98,
      amountRefunded: 20,
      currency: "gbp",
      createdAt: new Date(1_792_638_076 * 1000),
      refunds: [
        {
          id: "fr_1UTCFnFx0CreatorSh0PlRwN",
          amount: 20,
          currency: "gbp",
          createdAt: new Date(1_792_638_079 * 1000),
          disputeId: null,
        },
      ],
    });
  });

  it("maps a lost dispute to its charge", async () => {
    const dispute = recordedObject("dispute");
    const result = await withRecordedStripe([dispute], (gateway) =>
      gateway.retrieveDispute("acct_recorded", dispute.id),
    );
    expect(result).toEqual({
      id: "du_1UTCFyFx0CreatorEafxzLDl",
      chargeId: "ch_3UTCFvFx0Creator0lqakA2v",
      paymentIntentId: "pi_3UTCFvFx0Creator0Kk9T91i",
      amount: 4900,
      currency: "gbp",
      status: "lost",
      createdAt: new Date(1_792_638_090 * 1000),
    });
  });

  it("maps a recorded subscription with its period end and fee percent", async () => {
    const subscription = recordedObject("subscription");
    const result = await withRecordedStripe([subscription], (gateway) =>
      gateway.retrieveSubscription("acct_recorded", subscription.id),
    );
    expect(result).toMatchObject({
      id: "sub_1UTCFvFx0CreatorkvQjZ1tk",
      status: "active",
      customerId: "cus_FakeCus01",
      currentPeriodEnd: new Date(1_795_316_487 * 1000),
      cancelAtPeriodEnd: false,
      endedAt: null,
      interval: "month",
      applicationFeePercent: 2,
      priceId: "price_1UTCFiFx0CreatorB21PMti9",
    });
  });
});
