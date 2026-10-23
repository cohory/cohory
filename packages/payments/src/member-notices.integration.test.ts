import type { Database } from "@cohory/db";
import { outbox } from "@cohory/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { GatewayInvoice, GatewaySubscription } from "./gateway";
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

function deliver(
  harness: Harness,
  type: string,
  object: Record<string, unknown> & { id: string },
  account: string,
) {
  const event = signedEvent(type, object, { account });
  return harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
}

interface Subscribed {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly subscription: GatewaySubscription;
}

async function subscribed(): Promise<Subscribed> {
  const harness = createHarness(probe.db);
  const paid = await setupPaidCommunity(admin.db, harness);
  const subscription = stripeSubscription(paid, paid.buyerId);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  const checkout = await deliver(
    harness,
    "checkout.session.completed",
    {
      id: `cs_${subscription.id}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: subscription.id,
      customer: subscription.customerId,
      metadata: subscription.metadata,
    },
    paid.accountId,
  );
  expect(checkout).toEqual({ status: 200, outcome: "processed" });
  return { harness, paid, subscription };
}

async function notices(paid: PaidCommunity): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(
      and(eq(outbox.communityId, paid.communityId), eq(outbox.topic, paidMembershipEventsTopic)),
    )
    .orderBy(asc(outbox.createdAt), asc(outbox.id));
  return rows.flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events);
}

function failedInvoice(subscription: GatewaySubscription, attempt: number): GatewayInvoice {
  return {
    id: `in_failed_${subscription.id}`,
    subscriptionId: subscription.id,
    status: "open",
    amountPaid: 0,
    amountDue: 4900,
    attemptCount: attempt,
    nextPaymentAttemptAt: new Date("2026-10-25T10:00:00Z"),
    taxMinor: 0,
    currency: "usd",
    paymentIntentIds: [],
    paidAt: null,
  };
}

describe("owner notices about paying members", () => {
  it("tells the owner once about a new paying member", async () => {
    const { harness, paid, subscription } = await subscribed();
    await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id },
      paid.accountId,
    );

    expect((await notices(paid)).map((event) => [event.type, event.payload])).toEqual([
      [
        "payments.paid_member_joined",
        expect.objectContaining({
          ownerId: paid.ownerId,
          userId: paid.buyerId,
          priceMinor: 4900,
          currency: "usd",
          interval: "month",
        }),
      ],
    ]);
  });

  it("tells the owner once when a member cancels at the period end", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.subscriptions.set(subscription.id, {
      ...subscription,
      cancelAtPeriodEnd: true,
    });

    await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id },
      paid.accountId,
    );
    await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id },
      paid.accountId,
    );

    const canceled = (await notices(paid)).filter(
      (event) => event.type === "payments.paid_member_canceled",
    );
    expect(canceled.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        ownerId: paid.ownerId,
        userId: paid.buyerId,
        endsAt: "2026-11-18T10:00:00.000Z",
      }),
    ]);
  });

  it("reports the first three failed payments of an invoice with a stable notice id", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "past_due" });
    const fail = async (attempt: number) => {
      harness.gateway.invoices.set(
        `in_failed_${subscription.id}`,
        failedInvoice(subscription, attempt),
      );
      await deliver(
        harness,
        "invoice.payment_failed",
        { id: `in_failed_${subscription.id}` },
        paid.accountId,
      );
    };

    await fail(1);
    await fail(1);
    await fail(2);
    await fail(3);
    await fail(4);

    const failed = (await notices(paid)).flatMap((event) =>
      event.type === "payments.member_payment_failed" ? [event.payload] : [],
    );
    expect(failed.map((payload) => payload.attempt)).toEqual([1, 1, 2, 3]);
    expect(failed[0]).toMatchObject({
      ownerId: paid.ownerId,
      userId: paid.buyerId,
      amountMinor: 4900,
      currency: "usd",
      nextAttemptAt: "2026-10-25T10:00:00.000Z",
    });
    expect(failed[1]?.noticeId).toBe(failed[0]?.noticeId);
    expect(new Set(failed.map((payload) => payload.noticeId)).size).toBe(3);
  });

  it("reports Stripe's last try when it plans no further attempt, however many tries came before", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "past_due" });
    harness.gateway.invoices.set(`in_failed_${subscription.id}`, {
      ...failedInvoice(subscription, 6),
      nextPaymentAttemptAt: null,
    });

    await deliver(
      harness,
      "invoice.payment_failed",
      { id: `in_failed_${subscription.id}` },
      paid.accountId,
    );

    const failed = (await notices(paid)).flatMap((event) =>
      event.type === "payments.member_payment_failed" ? [event.payload] : [],
    );
    expect(failed).toEqual([
      expect.objectContaining({ userId: paid.buyerId, attempt: 6, nextAttemptAt: null }),
    ]);
  });

  it("still reports the last try when the cancellation was processed first", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });
    await deliver(
      harness,
      "customer.subscription.deleted",
      { id: subscription.id },
      paid.accountId,
    );
    harness.gateway.invoices.set(`in_failed_${subscription.id}`, {
      ...failedInvoice(subscription, 4),
      nextPaymentAttemptAt: null,
    });

    await deliver(
      harness,
      "invoice.payment_failed",
      { id: `in_failed_${subscription.id}` },
      paid.accountId,
    );

    const failed = (await notices(paid)).flatMap((event) =>
      event.type === "payments.member_payment_failed" ? [event.payload] : [],
    );
    expect(failed).toEqual([expect.objectContaining({ attempt: 4, nextAttemptAt: null })]);
  });

  it("ignores a late failed payment event for an invoice that is already paid", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.invoices.set(`in_failed_${subscription.id}`, {
      ...failedInvoice(subscription, 1),
      status: "paid",
      amountPaid: 4900,
      amountDue: 0,
      paidAt: new Date("2026-10-24T10:00:00Z"),
    });

    await deliver(
      harness,
      "invoice.payment_failed",
      { id: `in_failed_${subscription.id}` },
      paid.accountId,
    );

    expect(
      (await notices(paid)).filter((event) => event.type === "payments.member_payment_failed"),
    ).toEqual([]);
  });
});
