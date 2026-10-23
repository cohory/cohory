import { getMembership, withCommunity, type Database } from "@cohory/db";
import { outbox, subscriptions } from "@cohory/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { GatewaySubscription } from "./gateway";
import { duplicateCancellationComment } from "./service/duplicate-subscriptions";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { openProbeDb, openTestDb } from "./test/fixtures";
import {
  createHarness,
  setupPaidCommunity,
  stripeSubscription,
  type Harness,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function send(
  harness: Harness,
  paid: PaidCommunity,
  type: string,
  object: Record<string, unknown> & { id: string },
): Promise<number> {
  harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
  const event = signedEvent(type, object, { account: paid.accountId });
  const result = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
  return result.status;
}

async function deliver(
  harness: Harness,
  paid: PaidCommunity,
  type: string,
  object: Record<string, unknown> & { id: string },
): Promise<void> {
  expect(await send(harness, paid, type, object)).toBe(200);
}

const outboxEvents = z.object({ events: z.array(z.looseObject({ type: z.string() })) });

async function refundNotices(paid: PaidCommunity): Promise<unknown[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.communityId, paid.communityId));
  return rows
    .flatMap((row) => outboxEvents.safeParse(row.payload).data?.events ?? [])
    .filter((event) => event.type === "payments.duplicate_refunded");
}

function paidSubscription(
  harness: Harness,
  paid: PaidCommunity,
  overrides: Partial<GatewaySubscription> = {},
): GatewaySubscription {
  const subscription = stripeSubscription(paid, paid.buyerId, overrides);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  harness.gateway.invoices.set(`in_${subscription.id}`, {
    id: `in_${subscription.id}`,
    subscriptionId: subscription.id,
    status: "paid",
    amountPaid: 4900,
    amountDue: 4900,
    attemptCount: 1,
    nextPaymentAttemptAt: null,
    taxMinor: 0,
    currency: "usd",
    paymentIntentIds: [`pi_${subscription.id}`],
    paidAt: harness.clock.now,
  });
  return subscription;
}

async function checkoutCompleted(
  harness: Harness,
  paid: PaidCommunity,
  subscription: GatewaySubscription,
): Promise<void> {
  await deliver(harness, paid, "checkout.session.completed", {
    id: `cs_${subscription.id}`,
    object: "checkout.session",
    mode: "subscription",
    subscription: subscription.id,
    customer: subscription.customerId,
    client_reference_id: paid.buyerId,
    metadata: subscription.metadata,
  });
}

async function grantingSubscriptions(paid: PaidCommunity): Promise<string[]> {
  const rows = await admin.db
    .select({ externalId: subscriptions.externalSubscriptionId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.communityId, paid.communityId),
        eq(subscriptions.userId, paid.buyerId),
        inArray(subscriptions.accessState, ["granted", "grace"]),
      ),
    );
  return rows.map((row) => row.externalId);
}

describe("a member who pays two checkout sessions", () => {
  it("keeps one active subscription and cancels and refunds the second", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const monthly = paidSubscription(harness, paid);
    const annual = paidSubscription(harness, paid, { interval: "year" });

    await checkoutCompleted(harness, paid, monthly);
    await checkoutCompleted(harness, paid, annual);
    await deliver(harness, paid, "customer.subscription.deleted", {
      id: annual.id,
      object: "subscription",
    });

    expect(await grantingSubscriptions(paid)).toEqual([monthly.id]);
    const [refund] = harness.gateway.writes("createRefund");
    expect(harness.gateway.writes("createRefund")).toHaveLength(1);
    expect(refund).toMatchObject({
      account: paid.accountId,
      input: { paymentIntentId: `pi_${annual.id}`, amountMinor: null },
    });
    const cancels = harness.gateway.writes("cancelSubscription");
    expect(cancels.map((call) => call.input)).toEqual([
      { subscriptionId: annual.id, comment: duplicateCancellationComment },
    ]);
    const order = harness.gateway.calls
      .map((call) => call.method)
      .filter((method) => method === "cancelSubscription" || method === "createRefund");
    expect(order).toEqual(["cancelSubscription", "createRefund"]);
    expect(await refundNotices(paid)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          userId: paid.buyerId,
          amountMinor: 4900,
          currency: "usd",
        }),
      }),
    ]);
    expect(harness.gateway.subscriptions.get(monthly.id)?.status).toBe("active");
    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership?.status).toBe("active");
  });

  it("refunds and cancels only once when Stripe sends the second subscription's events again", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const first = paidSubscription(harness, paid);
    const second = paidSubscription(harness, paid);

    await checkoutCompleted(harness, paid, first);
    await checkoutCompleted(harness, paid, second);
    await deliver(harness, paid, "customer.subscription.updated", {
      id: second.id,
      object: "subscription",
    });
    await deliver(harness, paid, "invoice.paid", { id: `in_${second.id}`, object: "invoice" });

    expect(harness.gateway.writes("createRefund")).toHaveLength(1);
    expect(harness.gateway.writes("cancelSubscription")).toHaveLength(1);
    expect(await grantingSubscriptions(paid)).toEqual([first.id]);
  });

  it("never touches a subscription the creator made in the Stripe Dashboard for a member", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const checkout = paidSubscription(harness, paid);
    await checkoutCompleted(harness, paid, checkout);
    const dashboard = paidSubscription(harness, paid, {
      customerId: checkout.customerId,
      metadata: {},
    });

    await deliver(harness, paid, "customer.subscription.created", {
      id: dashboard.id,
      object: "subscription",
    });

    expect(harness.gateway.writes("createRefund")).toHaveLength(0);
    expect(harness.gateway.writes("cancelSubscription")).toHaveLength(0);
    expect((await grantingSubscriptions(paid)).sort()).toEqual([checkout.id, dashboard.id].sort());
  });

  it("leaves both alone when Stripe says the first subscription no longer renews", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const first = paidSubscription(harness, paid);
    const second = paidSubscription(harness, paid);
    await checkoutCompleted(harness, paid, first);
    harness.gateway.subscriptions.set(first.id, { ...first, cancelAtPeriodEnd: true });

    await checkoutCompleted(harness, paid, second);

    expect(harness.gateway.writes("createRefund")).toHaveLength(0);
    expect(harness.gateway.writes("cancelSubscription")).toHaveLength(0);
  });

  it("still refunds when the refund failed after the cancel went through", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const first = paidSubscription(harness, paid);
    const second = paidSubscription(harness, paid);
    await checkoutCompleted(harness, paid, first);
    harness.gateway.failOn(
      "createRefund",
      `pi_${second.id}`,
      new Stripe.errors.StripeAPIError({ message: "try later" }),
      1,
    );

    expect(
      await send(harness, paid, "checkout.session.completed", {
        id: `cs_${second.id}`,
        object: "checkout.session",
        mode: "subscription",
        subscription: second.id,
        customer: second.customerId,
        client_reference_id: paid.buyerId,
        metadata: second.metadata,
      }),
    ).not.toBe(200);
    expect(harness.gateway.subscriptions.get(second.id)?.status).toBe("canceled");

    await deliver(harness, paid, "customer.subscription.deleted", {
      id: second.id,
      object: "subscription",
    });
    await deliver(harness, paid, "customer.subscription.updated", {
      id: second.id,
      object: "subscription",
    });

    const refunds = harness.gateway.writes("createRefund");
    expect(refunds).toHaveLength(2);
    expect(new Set(refunds.map((call) => call.idempotencyKey)).size).toBe(1);
    expect(await refundNotices(paid)).toHaveLength(1);
    expect(await grantingSubscriptions(paid)).toEqual([first.id]);
  });

  it("lets a member start a new subscription while the old one runs out at period end", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const ending = paidSubscription(harness, paid, { cancelAtPeriodEnd: true });
    const next = paidSubscription(harness, paid, { status: "trialing" });

    await checkoutCompleted(harness, paid, ending);
    await checkoutCompleted(harness, paid, next);

    expect(harness.gateway.writes("createRefund")).toHaveLength(0);
    expect(harness.gateway.writes("cancelSubscription")).toHaveLength(0);
    expect((await grantingSubscriptions(paid)).sort()).toEqual([ending.id, next.id].sort());
  });
});
