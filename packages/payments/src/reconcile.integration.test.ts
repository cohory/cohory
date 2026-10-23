import { getMembership, withCommunity, type Database } from "@cohory/db";
import { feeLedgerEntries, paymentConnections, subscriptions } from "@cohory/db/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cloudEnv, openProbeDb, openTestDb } from "./test/fixtures";
import {
  createHarness,
  existingSubscriber,
  setupPaidCommunity,
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

async function connectionIdOf(paid: PaidCommunity): Promise<string> {
  const [row] = await admin.db
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, paid.communityId));
  return row?.id ?? "";
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

async function paidSetup(): Promise<{
  harness: Harness;
  paid: PaidCommunity;
  connectionId: string;
}> {
  const harness = createHarness(probe.db, cloudEnv(), null, { webhooks: "worker" });
  const paid = await setupPaidCommunity(admin.db, harness);
  return { harness, paid, connectionId: await connectionIdOf(paid) };
}

function ours(paid: PaidCommunity) {
  return {
    cohory_community_id: paid.communityId,
    cohory_user_id: paid.buyerId,
    cohory_plan_id: paid.planId,
  };
}

describe("daily reconciliation of a connection", () => {
  it("creates the mirror and grants access for a subscription whose webhooks never arrived", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    const { subscription } = existingSubscriber(harness.gateway, null, {
      metadata: ours(paid),
      applicationFeePercent: 2,
    });

    const result = await harness.service.reconcileConnection(connectionId);

    expect(result).toEqual({ skipped: false, complete: true, subscriptions: 1, feeEvents: 0 });
    expect(await subscriptionRow(subscription.id)).toMatchObject({
      userId: paid.buyerId,
      accessState: "granted",
      applicationFeeBps: 200,
    });
    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership?.status).toBe("active");
  });

  it("revokes access for a subscription whose cancellation webhook never arrived", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    const { subscription } = existingSubscriber(harness.gateway, null, { metadata: ours(paid) });
    await harness.service.reconcileConnection(connectionId);
    harness.gateway.summaries.delete(subscription.id);
    harness.gateway.subscriptions.set(subscription.id, {
      ...subscription,
      status: "canceled",
      endedAt: harness.clock.now,
    });
    harness.clock.now = new Date(harness.clock.now.getTime() + 60_000);

    const result = await harness.service.reconcileConnection(connectionId);

    expect(result.subscriptions).toBe(1);
    const row = await subscriptionRow(subscription.id);
    expect(row?.providerStatus).toBe("canceled");
    expect(row?.accessState).not.toBe("granted");
    expect(
      harness.gateway.writes("listSubscriptions").map((call) => call.input),
    ).not.toContainEqual(expect.objectContaining({ includeCanceled: true }));
  });

  it("stops when its time budget runs out and reports the run incomplete", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    existingSubscriber(harness.gateway, null, { metadata: ours(paid) });
    existingSubscriber(harness.gateway, null, { metadata: ours(paid) });

    const stopped = await harness.service.reconcileConnection(connectionId, { budgetMs: 0 });

    expect(stopped).toEqual({ skipped: false, complete: false, subscriptions: 0, feeEvents: 0 });
    expect(harness.gateway.writes("retrieveSubscription")).toEqual([]);
    expect(await harness.service.reconcileConnection(connectionId)).toMatchObject({
      complete: true,
      subscriptions: 2,
    });
  });

  it("leaves subscriptions that already match the mirror alone", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    existingSubscriber(harness.gateway, null, { metadata: ours(paid) });
    existingSubscriber(harness.gateway, null, { status: "canceled" });
    await harness.service.reconcileConnection(connectionId);
    const fetches = harness.gateway.writes("retrieveSubscription").length;

    const again = await harness.service.reconcileConnection(connectionId);

    expect(again.subscriptions).toBe(0);
    expect(harness.gateway.writes("retrieveSubscription")).toHaveLength(fetches);
  });

  it("records a missed application fee and refunds the fee for a missed partial refund once", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    const chargeId = `ch_reconcile_${paid.communityId}`;
    const feeId = `fee_reconcile_${paid.communityId}`;
    harness.gateway.charges.set(chargeId, {
      id: chargeId,
      amount: 5000,
      amountRefunded: 1000,
      currency: "usd",
      paymentIntentId: `pi_reconcile_${paid.communityId}`,
      applicationFeeId: feeId,
    });
    harness.gateway.fees.set(feeId, {
      id: feeId,
      accountId: paid.accountId,
      chargeId,
      amount: 100,
      amountRefunded: 0,
      currency: "usd",
      createdAt: new Date("2026-10-17T10:00:00.000Z"),
      refunds: [],
    });

    const first = await harness.service.reconcileConnection(connectionId);
    const second = await harness.service.reconcileConnection(connectionId);

    expect(first.feeEvents).toBe(2);
    expect(second.feeEvents).toBe(2);
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([
      expect.objectContaining({ input: { feeId, amountMinor: 20 } }),
    ]);
    const ledger = await ledgerOf(paid);
    expect(ledger.map((entry) => [entry.kind, entry.providerFeeMinor])).toEqual([
      ["fee_collected", 100],
      ["fee_refunded", -20],
    ]);
  });

  it("ignores a fee that belongs to another connected account", async () => {
    const { harness, paid, connectionId } = await paidSetup();
    const chargeId = `ch_other_${paid.communityId}`;
    const feeId = `fee_other_${paid.communityId}`;
    harness.gateway.charges.set(chargeId, {
      id: chargeId,
      amount: 5000,
      amountRefunded: 0,
      currency: "usd",
      paymentIntentId: null,
      applicationFeeId: feeId,
    });
    harness.gateway.fees.set(feeId, {
      id: feeId,
      accountId: "acct_someone_else",
      chargeId,
      amount: 100,
      amountRefunded: 0,
      currency: "usd",
      createdAt: new Date("2026-10-17T10:00:00.000Z"),
      refunds: [],
    });

    const result = await harness.service.reconcileConnection(connectionId);

    expect(result.feeEvents).toBe(0);
    expect(await ledgerOf(paid)).toEqual([]);
  });

  it("skips a connection that is no longer active", async () => {
    const { harness, connectionId } = await paidSetup();
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: harness.clock.now })
      .where(eq(paymentConnections.id, connectionId));

    expect(await harness.service.reconcileConnection(connectionId)).toEqual({
      skipped: true,
      complete: true,
      subscriptions: 0,
      feeEvents: 0,
    });
    expect(harness.gateway.writes("listSubscriptions")).toEqual([]);
  });
});

describe("the daily reconciliation sweep", () => {
  it("schedules one job for each active connection and none for a disconnected one", async () => {
    const active = await paidSetup();
    const gone = await paidSetup();
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: gone.harness.clock.now })
      .where(eq(paymentConnections.id, gone.connectionId));

    const result = await active.harness.service.scheduleConnectionReconciles();

    const scheduled = active.harness.queue.reconciles.map((job) => job.connectionId);
    expect(scheduled).toContain(active.connectionId);
    expect(scheduled).not.toContain(gone.connectionId);
    expect(result.scheduled).toBe(scheduled.length);
  });
});
