import { randomUUID } from "node:crypto";

import type { Database } from "@cohory/db";
import { feeLedgerEntries, payments, providerEvents, subscriptions } from "@cohory/db/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPaymentsRepository } from "./postgres-repository";
import { eventLeaseMs, WebhookEventBusyError } from "./service/webhooks";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { cloudEnv, openProbeDb, openTestDb } from "./test/fixtures";
import {
  recordedEvent,
  recordedObject,
  signRecorded,
  withRecordedStripe,
  type RecordedEventType,
  type RecordedObject,
} from "./test/fixtures/stripe";
import {
  createHarness,
  setupPaidCommunity,
  stripeSubscription,
  type Harness,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const run = randomUUID().slice(0, 8);

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

function workerHarness(): Harness {
  return createHarness(probe.db, cloudEnv(), null, { webhooks: "worker" });
}

function subscriptionEvent(paid: PaidCommunity, type: string, subscriptionId: string) {
  const event = signedEvent(
    type,
    { id: subscriptionId, object: "subscription" },
    { account: paid.accountId },
  );
  return { id: event.id, request: { rawBody: event.rawBody, signature: event.signature } };
}

async function inboxRow(externalEventId: string) {
  const [row] = await admin.db
    .select()
    .from(providerEvents)
    .where(eq(providerEvents.externalEventId, externalEventId));
  return row ?? null;
}

async function subscriptionRow(externalId: string) {
  const [row] = await admin.db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.externalSubscriptionId, externalId));
  return row ?? null;
}

async function ledgerOf(paid: PaidCommunity) {
  return admin.db
    .select()
    .from(feeLedgerEntries)
    .where(eq(feeLedgerEntries.communityId, paid.communityId))
    .orderBy(asc(feeLedgerEntries.id));
}

async function paymentOf(paid: PaidCommunity) {
  const [row] = await admin.db
    .select()
    .from(payments)
    .where(eq(payments.communityId, paid.communityId));
  return row ?? null;
}

describe("webhooks through the worker", () => {
  it("stores the event and answers 200 before anything is processed", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const { id, request } = subscriptionEvent(
      paid,
      "customer.subscription.created",
      subscription.id,
    );

    const result = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(result).toEqual({ status: 200, outcome: "queued" });
    const stored = await inboxRow(id);
    expect(stored).toMatchObject({ attempts: 0, processedAt: null });
    expect(harness.queue.webhookEvents).toEqual([
      { providerEventId: stored?.id, connectionId: stored?.connectionId },
    ]);
    expect(harness.gateway.writes("retrieveEvent")).toEqual([]);
    expect(harness.gateway.writes("retrieveSubscription")).toEqual([]);
    expect(await subscriptionRow(subscription.id)).toBeNull();

    expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
    expect(harness.gateway.writes("retrieveEvent")).toEqual([
      expect.objectContaining({ account: paid.accountId, input: { eventId: id } }),
    ]);
    expect(await subscriptionRow(subscription.id)).toMatchObject({ accessState: "granted" });
    expect(await inboxRow(id)).toMatchObject({ attempts: 1, communityId: paid.communityId });
    expect((await inboxRow(id))?.processedAt).not.toBeNull();
  });

  it("applies a duplicate delivery once, before and after the worker runs", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const { request } = subscriptionEvent(paid, "customer.subscription.updated", subscription.id);

    const first = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );
    const second = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );
    const runs = await harness.queue.runWebhookJobs();
    const late = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect([first, second]).toEqual([
      { status: 200, outcome: "queued" },
      { status: 200, outcome: "queued" },
    ]);
    expect(runs).toEqual(["processed", "duplicate"]);
    expect(late).toEqual({ status: 200, outcome: "duplicate" });
    expect(harness.gateway.writes("retrieveSubscription")).toHaveLength(1);
  });

  it("converges on the fetched state when deliveries arrive out of order", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId, {
      status: "canceled",
      endedAt: new Date("2026-10-18T09:00:00.000Z"),
    });
    harness.gateway.subscriptions.set(subscription.id, subscription);

    await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(
        subscriptionEvent(paid, "customer.subscription.deleted", subscription.id).request,
      ),
    );
    await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(
        subscriptionEvent(paid, "customer.subscription.created", subscription.id).request,
      ),
    );

    expect(await harness.queue.runWebhookJobs()).toEqual(["processed", "processed"]);
    const row = await subscriptionRow(subscription.id);
    expect(row?.providerStatus).toBe("canceled");
    expect(row?.accessState).not.toBe("granted");
  });

  it("keeps a failed job for a retry that then processes the event", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    const { id, request } = subscriptionEvent(
      paid,
      "customer.subscription.created",
      subscription.id,
    );
    await harness.service.handleWebhook({ setup: "platform_account" }, stripeDelivery(request));

    const failed = await harness.queue.runWebhookJobs();

    expect(failed).toEqual([expect.any(Error)]);
    expect(harness.queue.webhookEvents).toHaveLength(1);
    expect(await inboxRow(id)).toMatchObject({ processedAt: null, claimedAt: null });
    expect(harness.logs.some((entry) => entry["msg"] === "stripe webhook processing failed")).toBe(
      true,
    );

    harness.gateway.subscriptions.set(subscription.id, subscription);
    expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
    expect(await inboxRow(id)).toMatchObject({ attempts: 2, error: null });
  });

  it("keeps the job for a retry when the event cannot be fetched from Stripe", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const { id, request } = subscriptionEvent(
      paid,
      "customer.subscription.created",
      subscription.id,
    );
    await harness.service.handleWebhook({ setup: "platform_account" }, stripeDelivery(request));
    harness.gateway.failOn("retrieveEvent", id, new Error("stripe is down"), 1);

    expect(await harness.queue.runWebhookJobs()).toEqual([expect.any(Error)]);
    expect(await inboxRow(id)).toMatchObject({ processedAt: null, error: "Error" });

    expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
    expect(await subscriptionRow(subscription.id)).toMatchObject({ accessState: "granted" });
  });

  it("retries later while another worker holds the event", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(
        subscriptionEvent(paid, "customer.subscription.created", subscription.id).request,
      ),
    );
    const [job] = harness.queue.webhookEvents;
    const repo = createPostgresPaymentsRepository(probe.db);
    await repo.claimEvent(job?.providerEventId ?? "", harness.clock.now, eventLeaseMs);

    expect(await harness.queue.runWebhookJobs()).toEqual([expect.any(WebhookEventBusyError)]);

    harness.clock.now = new Date(harness.clock.now.getTime() + eventLeaseMs + 1);
    expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
  });

  it("answers 500 when the queue is down so Stripe delivers again", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const { id, request } = subscriptionEvent(
      paid,
      "customer.subscription.created",
      subscription.id,
    );

    harness.queue.down = true;
    const refused = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );
    harness.queue.down = false;
    const redelivered = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(refused).toEqual({ status: 500, outcome: "failed" });
    expect(redelivered).toEqual({ status: 200, outcome: "queued" });
    expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
    expect((await inboxRow(id))?.processedAt).not.toBeNull();
  });
});

function withAccount(object: RecordedObject, account: string): RecordedObject {
  return { ...object, account };
}

function withMetadata(object: RecordedObject, paid: PaidCommunity): RecordedObject {
  return {
    ...object,
    metadata: {
      cohory_community_id: paid.communityId,
      cohory_user_id: paid.buyerId,
      cohory_plan_id: paid.planId,
    },
  };
}

async function seed(
  harness: Harness,
  objects: {
    readonly subscription?: RecordedObject;
    readonly invoice?: RecordedObject;
    readonly charge?: RecordedObject;
    readonly fee?: RecordedObject;
    readonly dispute?: RecordedObject;
  },
): Promise<void> {
  const served = Object.values(objects).filter((object) => object !== undefined);
  await withRecordedStripe(served, async (stripe) => {
    const { gateway } = harness;
    if (objects.subscription) {
      const id = objects.subscription.id;
      gateway.subscriptions.set(id, await stripe.retrieveSubscription("acct_recorded", id));
    }
    if (objects.invoice) {
      const id = objects.invoice.id;
      gateway.invoices.set(id, await stripe.retrieveInvoice("acct_recorded", id));
    }
    if (objects.charge) {
      const id = objects.charge.id;
      gateway.charges.set(id, await stripe.retrieveCharge("acct_recorded", id));
    }
    if (objects.fee) {
      gateway.fees.set(objects.fee.id, await stripe.retrieveApplicationFee(objects.fee.id));
    }
    if (objects.dispute) {
      const id = objects.dispute.id;
      gateway.disputes.set(id, await stripe.retrieveDispute("acct_recorded", id));
    }
  });
}

async function replay(harness: Harness, paid: PaidCommunity, type: RecordedEventType) {
  const event = recordedEvent(type);
  const signed = signRecorded(event, paid.accountId, { id: `${event.id}_${run}` });
  const accepted = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery(signed),
  );
  expect(accepted).toEqual({ status: 200, outcome: "queued" });
  expect(await harness.queue.runWebhookJobs()).toEqual(["processed"]);
}

describe("recorded Stripe test mode events through the worker", () => {
  it("replays a subscription's lifecycle, its fee, and a partial refund", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const objectOf = (type: RecordedEventType) => recordedEvent(type).data.object;
    const subscriptionId = objectOf("customer.subscription.created").id;

    await seed(harness, {
      subscription: withMetadata(objectOf("customer.subscription.created"), paid),
    });
    await replay(harness, paid, "customer.subscription.created");
    expect(await subscriptionRow(subscriptionId)).toMatchObject({
      providerStatus: "active",
      accessState: "granted",
      applicationFeeBps: 200,
      cancelAtPeriodEnd: false,
    });

    await seed(harness, {
      subscription: withMetadata(objectOf("customer.subscription.updated"), paid),
    });
    harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
    await replay(harness, paid, "customer.subscription.updated");
    expect(await subscriptionRow(subscriptionId)).toMatchObject({ cancelAtPeriodEnd: true });

    await seed(harness, {
      fee: withAccount(objectOf("application_fee.created"), paid.accountId),
      charge: recordedObject("charge"),
    });
    await replay(harness, paid, "application_fee.created");
    expect(await ledgerOf(paid)).toContainEqual(
      expect.objectContaining({ kind: "fee_collected", providerFeeMinor: 98, currency: "gbp" }),
    );

    await seed(harness, {
      charge: objectOf("charge.refunded"),
      fee: withAccount(recordedObject("applicationFee"), paid.accountId),
    });
    await replay(harness, paid, "charge.refunded");
    await seed(harness, { fee: withAccount(objectOf("application_fee.refunded"), paid.accountId) });
    await replay(harness, paid, "application_fee.refunded");
    const ledger = await ledgerOf(paid);
    expect(ledger.filter((entry) => entry.kind === "fee_refunded")).toEqual([
      expect.objectContaining({ providerFeeMinor: -20, currency: "gbp", reason: null }),
    ]);
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);

    await seed(harness, {
      subscription: withMetadata(objectOf("customer.subscription.deleted"), paid),
    });
    harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
    await replay(harness, paid, "customer.subscription.deleted");
    const ended = await subscriptionRow(subscriptionId);
    expect(ended?.providerStatus).toBe("canceled");
    expect(ended?.accessState).not.toBe("granted");
  });

  it("replays a lost dispute, marks the payment, and refunds the platform fee", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const charge = recordedObject("disputedCharge");
    const invoice = recordedEvent("invoice.paid").data.object;
    const expanded = {
      ...invoice,
      payments: {
        object: "list",
        data: [{ payment: { type: "payment_intent", payment_intent: charge["payment_intent"] } }],
      },
    };

    await seed(harness, {
      invoice: expanded,
      subscription: withMetadata(recordedObject("subscription"), paid),
    });
    await replay(harness, paid, "invoice.paid");
    expect(await paymentOf(paid)).toMatchObject({
      amountMinor: 4900,
      currency: "gbp",
      externalPaymentIntentId: charge["payment_intent"],
      disputeStatus: null,
    });

    await seed(harness, {
      charge,
      fee: withAccount(recordedObject("disputedFee"), paid.accountId),
    });
    for (const type of [
      "charge.dispute.created",
      "charge.dispute.updated",
      "charge.dispute.funds_withdrawn",
    ] as const) {
      await seed(harness, { dispute: recordedEvent(type).data.object });
      await replay(harness, paid, type);
      expect((await paymentOf(paid))?.disputeStatus).toBe("open");
    }
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);

    const closed = recordedEvent("charge.dispute.closed").data.object;
    await seed(harness, { dispute: closed });
    await replay(harness, paid, "charge.dispute.closed");

    expect((await paymentOf(paid))?.disputeStatus).toBe("lost");
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([
      expect.objectContaining({
        idempotencyKey: `fee-refund:dispute:${closed.id}`,
        input: { feeId: recordedObject("disputedFee").id, amountMinor: 98, disputeId: closed.id },
      }),
    ]);
    expect(await ledgerOf(paid)).toContainEqual(
      expect.objectContaining({
        kind: "fee_refunded",
        providerFeeMinor: -98,
        reason: "dispute_lost",
      }),
    );
  });

  it("replays a failed invoice payment and an account update", async () => {
    const harness = workerHarness();
    const paid = await setupPaidCommunity(admin.db, harness);
    const invoice = recordedEvent("invoice.payment_failed").data.object;
    await seed(harness, { invoice });
    const subscriptionId = harness.gateway.invoices.get(invoice.id)?.subscriptionId ?? "";
    harness.gateway.subscriptions.set(
      subscriptionId,
      stripeSubscription(paid, paid.buyerId, { id: subscriptionId, status: "incomplete" }),
    );

    await replay(harness, paid, "invoice.payment_failed");
    expect(await subscriptionRow(subscriptionId)).toMatchObject({
      providerStatus: "incomplete",
      accessState: "none",
    });

    await replay(harness, paid, "account.updated");
  });
});
