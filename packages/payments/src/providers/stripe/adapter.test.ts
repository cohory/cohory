import { describe, expect, it } from "vitest";

import { PaymentsUnavailableError } from "../../errors";
import type { VerifiedEvent } from "../../gateway";
import { WebhookSignatureError } from "../../stripe-gateway";
import { createFakeGateway } from "../../test/fake-gateway";
import type { Connection } from "../types";
import { createStripeProvider, type StripeProviderDeps } from "./adapter";

const communityId = "0199f000-0000-7000-8000-000000000001";

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "0199f000-0000-7000-8000-0000000000c1",
    communityId,
    provider: "stripe_connect",
    externalAccountId: "acct_creator",
    livemode: false,
    apiCredential: null,
    webhookSecret: null,
    ...overrides,
  };
}

function event(type: string, object: Record<string, unknown> & { id: string }): VerifiedEvent {
  return { id: "evt_1", type, account: "acct_creator", livemode: false, object };
}

function setup() {
  const gateway = createFakeGateway();
  const deps = {
    platformGateway: gateway,
    gatewayForSecret: () => gateway,
    verifyWebhook: null,
    webhookSecrets: [],
    platformSecretKey: "sk_test_platform",
    connectClientId: "ca_cohory",
  };
  return {
    gateway,
    connect: createStripeProvider("stripe_connect", deps),
    own: createStripeProvider("stripe_own_keys", deps),
  };
}

describe("Stripe provider adapter", () => {
  it("turns a paid invoice into a subscription change and a payment", async () => {
    const { gateway, connect } = setup();
    gateway.invoices.set("in_1", {
      id: "in_1",
      subscriptionId: "sub_1",
      status: "paid",
      amountPaid: 4900,
      amountDue: 4900,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 9000,
      currency: "usd",
      paymentIntentIds: ["pi_1"],
      paidAt: new Date("2026-10-18T10:00:00Z"),
    });
    const events = await connect.normalizeEvent(event("invoice.paid", { id: "in_1" }), conn());
    expect(events).toEqual([
      { kind: "subscription_changed", subscriptionId: "sub_1" },
      {
        kind: "payment_succeeded",
        payment: {
          externalId: "in_1",
          subscriptionId: "sub_1",
          paymentRef: "pi_1",
          currency: "usd",
          amountMinor: 4900,
          taxMinor: 4900,
          paidAt: new Date("2026-10-18T10:00:00Z"),
        },
      },
    ]);
  });

  it("records no payment for a failed or zero amount invoice", async () => {
    const { gateway, connect } = setup();
    gateway.invoices.set("in_2", {
      id: "in_2",
      subscriptionId: "sub_2",
      status: "open",
      amountPaid: 0,
      amountDue: 0,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 0,
      currency: "usd",
      paymentIntentIds: [],
      paidAt: null,
    });
    expect(await connect.normalizeEvent(event("invoice.paid", { id: "in_2" }), conn())).toEqual([
      { kind: "subscription_changed", subscriptionId: "sub_2" },
    ]);
  });

  it("reports a failed renewal with its amount, attempt, and next try", async () => {
    const { gateway, connect } = setup();
    const nextTry = new Date("2026-10-25T10:00:00Z");
    gateway.invoices.set("in_3", {
      id: "in_3",
      subscriptionId: "sub_3",
      status: "open",
      amountPaid: 0,
      amountDue: 4900,
      attemptCount: 2,
      nextPaymentAttemptAt: nextTry,
      taxMinor: 0,
      currency: "usd",
      paymentIntentIds: [],
      paidAt: null,
    });

    expect(
      await connect.normalizeEvent(event("invoice.payment_failed", { id: "in_3" }), conn()),
    ).toEqual([
      { kind: "subscription_changed", subscriptionId: "sub_3" },
      {
        kind: "payment_failed",
        failure: {
          invoiceRef: "in_3",
          subscriptionRef: "sub_3",
          amountMinor: 4900,
          currency: "usd",
          attempt: 2,
          nextAttemptAt: nextTry,
        },
      },
    ]);
  });

  it("ignores an application fee that belongs to another account", async () => {
    const { gateway, connect } = setup();
    gateway.fees.set("fee_1", {
      id: "fee_1",
      accountId: "acct_other",
      chargeId: "ch_1",
      amount: 49,
      amountRefunded: 0,
      currency: "usd",
      createdAt: new Date(),
      refunds: [],
    });
    expect(
      await connect.normalizeEvent(event("application_fee.created", { id: "fee_1" }), conn()),
    ).toEqual([]);
  });

  it("never reports platform fees or account events for own keys", async () => {
    const { own } = setup();
    const ownConn = conn({ provider: "stripe_own_keys", apiCredential: "sk_test_x" });
    for (const type of [
      "application_fee.created",
      "account.updated",
      "account.application.deauthorized",
    ]) {
      expect(await own.normalizeEvent(event(type, { id: "x_1" }), ownConn)).toEqual([]);
    }
    expect(own.platformFees).toBeUndefined();
    expect(own.capabilities(ownConn).supportsFeeSplit).toBe(false);
  });

  it("reports the platform fee id on a refunded charge only for Connect", async () => {
    const { gateway, connect, own } = setup();
    gateway.charges.set("ch_1", {
      id: "ch_1",
      amount: 4900,
      amountRefunded: 1000,
      currency: "usd",
      paymentIntentId: "pi_1",
      applicationFeeId: "fee_1",
    });
    const [connected] =
      (await connect.normalizeEvent(event("charge.refunded", { id: "ch_1" }), conn())) ?? [];
    const [owned] =
      (await own.normalizeEvent(
        event("charge.refunded", { id: "ch_1" }),
        conn({ provider: "stripe_own_keys", apiCredential: "sk_test_x" }),
      )) ?? [];
    expect(connected).toMatchObject({ refund: { platformFeeId: "fee_1", refundedMinor: 1000 } });
    expect(owned).toMatchObject({ refund: { platformFeeId: null, paymentRefundedMinor: 1000 } });
  });

  it("reads every dispute event from the fetched dispute and its charge", async () => {
    const { gateway, connect, own } = setup();
    gateway.charges.set("ch_1", {
      id: "ch_1",
      amount: 4900,
      amountRefunded: 1000,
      currency: "usd",
      paymentIntentId: "pi_1",
      applicationFeeId: "fee_1",
    });
    gateway.disputes.set("dp_1", {
      id: "dp_1",
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      amount: 3900,
      currency: "usd",
      status: "lost",
      createdAt: new Date("2026-10-25T08:00:00Z"),
    });
    const stale = { id: "dp_1", object: "dispute", status: "needs_response" };
    for (const type of [
      "charge.dispute.created",
      "charge.dispute.updated",
      "charge.dispute.closed",
      "charge.dispute.funds_withdrawn",
      "charge.dispute.funds_reinstated",
    ]) {
      expect(await connect.normalizeEvent(event(type, stale), conn())).toEqual([
        {
          kind: "dispute_changed",
          dispute: {
            id: "dp_1",
            status: "lost",
            chargeRef: "ch_1",
            paymentRef: "pi_1",
            currency: "usd",
            disputedMinor: 3900,
            chargedMinor: 4900,
            refundedMinor: 1000,
            platformFeeId: "fee_1",
            openedAt: new Date("2026-10-25T08:00:00Z"),
          },
        },
      ]);
    }
    const [owned] =
      (await own.normalizeEvent(
        event("charge.dispute.closed", stale),
        conn({ provider: "stripe_own_keys", apiCredential: "sk_test_x" }),
      )) ?? [];
    expect(owned).toMatchObject({ dispute: { platformFeeId: null } });
  });

  it.each([
    ["warning_needs_response", "open"],
    ["warning_under_review", "open"],
    ["needs_response", "open"],
    ["under_review", "open"],
    ["a_future_status", "open"],
    ["warning_closed", "won"],
    ["prevented", "won"],
    ["won", "won"],
    ["lost", "lost"],
  ])("maps the Stripe dispute status %s to %s", async (stripeStatus, status) => {
    const { gateway, connect } = setup();
    gateway.charges.set("ch_1", {
      id: "ch_1",
      amount: 4900,
      amountRefunded: 0,
      currency: "usd",
      paymentIntentId: "pi_1",
      applicationFeeId: null,
    });
    gateway.disputes.set("dp_1", {
      id: "dp_1",
      chargeId: "ch_1",
      paymentIntentId: null,
      amount: 4900,
      currency: "usd",
      status: stripeStatus,
      createdAt: new Date(),
    });
    const [normalized] =
      (await connect.normalizeEvent(event("charge.dispute.updated", { id: "dp_1" }), conn())) ?? [];
    expect(normalized).toMatchObject({ dispute: { status, paymentRef: "pi_1" } });
  });

  it("treats a dispute in another currency than its charge as covering the whole charge", async () => {
    const { gateway, connect } = setup();
    gateway.charges.set("ch_1", {
      id: "ch_1",
      amount: 4900,
      amountRefunded: 0,
      currency: "eur",
      paymentIntentId: "pi_1",
      applicationFeeId: "fee_1",
    });
    gateway.disputes.set("dp_1", {
      id: "dp_1",
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      amount: 5300,
      currency: "usd",
      status: "lost",
      createdAt: new Date(),
    });
    const [normalized] =
      (await connect.normalizeEvent(event("charge.dispute.closed", { id: "dp_1" }), conn())) ?? [];
    expect(normalized).toMatchObject({ dispute: { disputedMinor: 4900, currency: "eur" } });
  });

  it("reports an early fraud warning with its charge id", async () => {
    const { connect } = setup();
    expect(
      await connect.normalizeEvent(
        event("radar.early_fraud_warning.created", { id: "issfr_1", charge: "ch_1" }),
        conn(),
      ),
    ).toEqual([{ kind: "fraud_warning", chargeRef: "ch_1" }]);
  });

  it("answers null for event types it does not handle", async () => {
    const { connect } = setup();
    expect(await connect.normalizeEvent(event("payout.paid", { id: "po_1" }), conn())).toBeNull();
  });

  it("keeps a checkout from another community from naming the buyer", async () => {
    const { connect } = setup();
    const events = await connect.normalizeEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        subscription: "sub_9",
        metadata: {
          cohory_community_id: "0199f000-0000-7000-8000-000000000099",
          cohory_user_id: "0199f000-0000-7000-8000-0000000000aa",
        },
      }),
      conn(),
    );
    expect(events).toEqual([
      { kind: "checkout_completed", subscriptionId: "sub_9", userIdHint: null },
    ]);
  });

  it("names the buyer of an expired checkout only when it belongs to the community", async () => {
    const { connect } = setup();
    const buyer = "0199f000-0000-7000-8000-0000000000aa";
    const expired = (community: string) =>
      connect.normalizeEvent(
        event("checkout.session.expired", {
          id: "cs_2",
          mode: "subscription",
          metadata: { cohory_community_id: community, cohory_user_id: buyer },
        }),
        conn(),
      );

    expect(await expired(communityId)).toEqual([{ kind: "checkout_expired", userIdHint: buyer }]);
    expect(await expired("0199f000-0000-7000-8000-000000000099")).toEqual([
      { kind: "checkout_expired", userIdHint: null },
    ]);
  });

  it("adds the Stripe session placeholder and the fee only on Connect", async () => {
    const { gateway, connect, own } = setup();
    const input = {
      priceId: "price_1",
      customerId: null,
      customerEmail: "a@example.com",
      clientReferenceId: "user",
      metadata: {},
      platformFeeBps: 200,
      trialEnd: null,
      expiresAt: new Date("2026-10-23T00:00:00Z"),
      submitMessage: null,
      successUrl: "https://app.test/c/x/membership?checkout=success",
      cancelUrl: "https://app.test/c/x/membership?checkout=cancel",
      idempotencyKey: "checkout:1",
    };
    await connect.createCheckout(input, conn());
    expect(gateway.lastCheckout()).toMatchObject({
      applicationFeePercent: 2,
      expiresAt: new Date("2026-10-23T00:00:00Z"),
      submitMessage: null,
      successUrl:
        "https://app.test/c/x/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    });
    await own.createCheckout(
      { ...input, idempotencyKey: "checkout:2" },
      conn({ provider: "stripe_own_keys", apiCredential: "sk_test_x" }),
    );
    expect(gateway.lastCheckout()?.applicationFeePercent).toBeNull();
  });

  it("clears the fee when the rate is zero and sets a percent otherwise", async () => {
    const { gateway, connect } = setup();
    gateway.subscriptions.set("sub_3", {
      id: "sub_3",
      status: "active",
      customerId: "cus_3",
      metadata: {},
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      interval: "month",
      applicationFeePercent: 2,
      priceId: null,
    });
    await connect.setPlatformFee?.("sub_3", 0, "disconnect:1", conn());
    await connect.setPlatformFee?.("sub_3", 250, "link:1", conn());
    expect(gateway.writes("clearSubscriptionApplicationFee")).toHaveLength(1);
    expect(gateway.writes("setSubscriptionApplicationFee")[0]?.input).toMatchObject({
      percent: 2.5,
    });
  });

  it("schedules or ends a subscription depending on the cancel option", async () => {
    const { gateway, connect } = setup();
    gateway.subscriptions.set("sub_4", {
      id: "sub_4",
      status: "active",
      customerId: "cus_4",
      metadata: {},
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      interval: "month",
      applicationFeePercent: null,
      priceId: null,
    });
    const scheduled = await connect.cancelSubscription(
      "sub_4",
      { atPeriodEnd: true, idempotencyKey: "cancel:1" },
      conn(),
    );
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    const ended = await connect.cancelSubscription(
      "sub_4",
      { atPeriodEnd: false, idempotencyKey: "cancel:2" },
      conn(),
    );
    expect(ended.status).toBe("canceled");
  });

  it("refunds the full payment when no amount is given", async () => {
    const { gateway, connect } = setup();
    await connect.refund("pi_1", "full", "refund:1", conn());
    expect(gateway.writes("createRefund")[0]?.input).toEqual({
      paymentIntentId: "pi_1",
      amountMinor: null,
    });
  });

  it("refuses to work without a connected account or platform key", async () => {
    const connect = createStripeProvider("stripe_connect", {
      platformGateway: null,
      gatewayForSecret: null,
      verifyWebhook: null,
      webhookSecrets: [],
      platformSecretKey: null,
      connectClientId: null,
    });
    await expect(connect.getAccountState(conn({ externalAccountId: null }))).rejects.toThrow(
      PaymentsUnavailableError,
    );
    expect(() => connect.verifyWebhook({ rawBody: "{}", header: () => "t=1,v1=x" }, null)).toThrow(
      WebhookSignatureError,
    );
  });

  it("receives Connect events on the platform endpoint and own keys events per connection", () => {
    const { connect, own } = setup();
    expect(connect.setup).toBe("platform_account");
    expect(own.setup).toBe("own_keys");
    expect(connect.platformWebhooks).toBeDefined();
    expect(own.platformWebhooks).toBeUndefined();
  });

  it("finds the connected account of a platform event on the event or its object", () => {
    const { connect } = setup();
    const accountOf = (value: VerifiedEvent) => connect.platformWebhooks?.accountOf(value);
    expect(accountOf(event("charge.refunded", { id: "ch_1" }))).toBe("acct_creator");
    const fee = { ...event("application_fee.created", { id: "fee_1", account: "acct_fee" }) };
    expect(accountOf({ ...fee, account: null })).toBe("acct_fee");
    expect(accountOf({ ...event("ping", { id: "x" }), account: null })).toBeNull();
  });

  it("keeps platform fee and deauthorization events after a disconnect", () => {
    const { connect } = setup();
    const after = (type: string) => connect.platformWebhooks?.acceptsAfterDisconnect(type);
    expect(after("application_fee.created")).toBe(true);
    expect(after("application_fee.refunded")).toBe(true);
    expect(after("account.application.deauthorized")).toBe(true);
    expect(after("invoice.paid")).toBe(false);
    expect(connect.platformFees?.isFeeEvent("application_fee.created")).toBe(true);
    expect(connect.platformFees?.isFeeEvent("account.application.deauthorized")).toBe(false);
  });

  it("needs webhook secrets, a verifier, and the platform key for the platform endpoint", () => {
    const gateway = createFakeGateway();
    const base: StripeProviderDeps = {
      platformGateway: gateway,
      gatewayForSecret: null,
      verifyWebhook: () => event("ping", { id: "x" }),
      webhookSecrets: ["whsec_platform"],
      platformSecretKey: "sk_test_platform",
      connectClientId: null,
    };
    const configured = (deps: StripeProviderDeps) =>
      createStripeProvider("stripe_connect", deps).platformWebhooks?.isConfigured();
    expect(configured(base)).toBe(true);
    expect(configured({ ...base, webhookSecrets: [] })).toBe(false);
    expect(configured({ ...base, platformSecretKey: null })).toBe(false);
  });

  it("expects live events from a live platform key or a live own key", () => {
    const gateway = createFakeGateway();
    const live = createStripeProvider("stripe_connect", {
      platformGateway: gateway,
      gatewayForSecret: () => gateway,
      verifyWebhook: null,
      webhookSecrets: [],
      platformSecretKey: "sk_live_platform",
      connectClientId: null,
    });
    const { connect, own } = setup();
    expect(live.expectsLiveEvents(conn())).toBe(true);
    expect(connect.expectsLiveEvents(conn({ livemode: true }))).toBe(false);
    expect(own.expectsLiveEvents(conn({ apiCredential: "sk_live_own" }))).toBe(true);
    expect(own.expectsLiveEvents(conn({ apiCredential: "sk_test_own", livemode: true }))).toBe(
      false,
    );
  });

  it("names the Connect application that created platform subscriptions", () => {
    const { connect, own } = setup();
    expect(connect.applicationId).toBe("ca_cohory");
    expect(own.applicationId ?? null).toBeNull();
  });

  it("onboards a connected account through the platform", async () => {
    const { gateway, connect, own } = setup();
    const onboarding = connect.hostedOnboarding?.();
    const account = await onboarding?.createAccount(
      { displayName: "Club", email: null, country: "de", metadata: {} },
      "connect:1:account",
    );
    expect(account?.id).toBeTruthy();
    const link = await onboarding?.createLink(
      { accountId: account?.id ?? "", refreshUrl: "https://x/r", returnUrl: "https://x/s" },
      "connect:1:link",
    );
    expect(link?.url).toBeTruthy();
    expect(gateway.writes("createConnectedAccount")).toHaveLength(1);
    expect(own.hostedOnboarding).toBeUndefined();
  });

  it("refuses onboarding without the platform key", () => {
    const connect = createStripeProvider("stripe_connect", {
      platformGateway: null,
      gatewayForSecret: null,
      verifyWebhook: null,
      webhookSecrets: [],
      platformSecretKey: null,
      connectClientId: null,
    });
    expect(() => connect.hostedOnboarding?.()).toThrow(PaymentsUnavailableError);
  });
});
