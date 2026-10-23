import type { Database } from "@cohory/db";
import { providerEvents, subscriptions } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { cloudEnv, openProbeDb, openTestDb } from "./test/fixtures";
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

const minute = 60_000;
const day = 24 * 60 * minute;

async function inboxRow(externalEventId: string) {
  const [row] = await admin.db
    .select()
    .from(providerEvents)
    .where(eq(providerEvents.externalEventId, externalEventId));
  return row ?? null;
}

async function accessOf(externalId: string) {
  const [row] = await admin.db
    .select({ accessState: subscriptions.accessState })
    .from(subscriptions)
    .where(eq(subscriptions.externalSubscriptionId, externalId));
  return row?.accessState ?? null;
}

async function delivered(
  at: Date,
): Promise<{ harness: Harness; paid: PaidCommunity; eventId: string; subscriptionId: string }> {
  const harness = createHarness(probe.db, cloudEnv(), null, { webhooks: "worker" });
  harness.clock.now = at;
  const paid = await setupPaidCommunity(admin.db, harness);
  const subscription = stripeSubscription(paid, paid.buyerId);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  const event = signedEvent(
    "customer.subscription.created",
    { id: subscription.id, object: "subscription" },
    { account: paid.accountId },
  );
  const result = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
  expect(result).toEqual({ status: 200, outcome: "queued" });
  harness.queue.webhookEvents.splice(0);
  return { harness, paid, eventId: event.id, subscriptionId: subscription.id };
}

describe("the hourly webhook sweep", () => {
  it("re-queues an event left unprocessed for over an hour, by id only", async () => {
    const at = new Date("2020-02-01T00:00:00.000Z");
    const { harness, eventId, subscriptionId } = await delivered(at);
    const row = await inboxRow(eventId);

    harness.clock.now = new Date(at.getTime() + 30 * minute);
    await harness.service.sweepWebhookEvents();
    expect(harness.queue.webhookEvents).toEqual([]);

    harness.clock.now = new Date(at.getTime() + 61 * minute);
    const result = await harness.service.sweepWebhookEvents();

    expect(result.requeued).toBeGreaterThanOrEqual(1);
    expect(harness.queue.webhookEvents).toContainEqual({
      providerEventId: row?.id,
      connectionId: row?.connectionId,
    });
    await harness.queue.runWebhookJobs();
    expect((await inboxRow(eventId))?.processedAt).not.toBeNull();
    expect(await accessOf(subscriptionId)).toBe("granted");
  });

  it("re-queues a platform billing event, which has no connection, on the billing queue", async () => {
    const harness = createHarness(probe.db, cloudEnv(), null, { webhooks: "worker" });
    const at = new Date("2020-03-01T00:00:00.000Z");
    const [row] = await admin.db
      .insert(providerEvents)
      .values({
        provider: "stripe_connect",
        externalEventId: `evt_billing_sweep_${at.getTime()}_${Math.random()}`,
        type: "invoice.paid",
        livemode: false,
        payloadHash: "0".repeat(64),
        receivedAt: at,
      })
      .returning({ id: providerEvents.id });
    harness.clock.now = new Date(at.getTime() + 2 * 60 * minute);

    await harness.service.sweepWebhookEvents();

    expect(harness.queue.billingEvents).toContainEqual({ providerEventId: row?.id });
    expect(harness.queue.webhookEvents).toEqual([]);
  });

  it("stops re-queuing after three days and logs the event once, by id and type", async () => {
    const at = new Date("2020-01-01T00:00:00.000Z");
    const { harness, eventId } = await delivered(at);
    harness.clock.now = new Date(at.getTime() + 3 * day + minute);

    const first = await harness.service.sweepWebhookEvents();
    const second = await harness.service.sweepWebhookEvents();

    expect(harness.queue.webhookEvents).toEqual([]);
    expect(first.abandoned).toBeGreaterThanOrEqual(1);
    expect(second.abandoned).toBe(0);
    const logged = harness.logs.filter(
      (entry) => entry["msg"] === "payment webhook event abandoned" && entry["eventId"] === eventId,
    );
    expect(logged).toEqual([
      {
        msg: "payment webhook event abandoned",
        level: "error",
        provider: "stripe_connect",
        eventId,
        type: "customer.subscription.created",
      },
    ]);
    expect(await inboxRow(eventId)).toMatchObject({ processedAt: null, error: "abandoned" });
  });
});

describe("replaying one stored webhook event", () => {
  it("queues an unprocessed event by its Stripe id and leaves a processed one alone", async () => {
    const { harness, eventId, subscriptionId } = await delivered(
      new Date("2020-04-01T00:00:00.000Z"),
    );
    const row = await inboxRow(eventId);

    expect(await harness.service.replayWebhookEvent(eventId)).toEqual({ kind: "queued" });
    expect(harness.queue.webhookEvents).toEqual([
      { providerEventId: row?.id, connectionId: row?.connectionId },
    ]);
    await harness.queue.runWebhookJobs();
    expect(await accessOf(subscriptionId)).toBe("granted");

    expect(await harness.service.replayWebhookEvent(eventId)).toEqual({ kind: "processed" });
    expect(await harness.service.replayWebhookEvent("evt_never_received")).toEqual({
      kind: "not_found",
    });
    expect(harness.queue.webhookEvents).toEqual([]);
  });
});
