import { getMembership, withCommunity, type Database } from "@cohory/db";
import { feeLedgerEntries, outbox, payments, subscriptions } from "@cohory/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { GatewayDispute, GatewaySubscription } from "./gateway";
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
  options: { account?: string | null; id?: string } = {},
) {
  const event = signedEvent(type, object, options);
  return harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
}

interface Paid {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly subscription: GatewaySubscription;
  readonly chargeId: string;
  readonly feeId: string;
}

async function paidMember(): Promise<Paid> {
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
    { account: paid.accountId },
  );
  expect(checkout).toEqual({ status: 200, outcome: "processed" });
  const chargeId = `ch_${subscription.id}`;
  const feeId = `fee_${subscription.id}`;
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
    paidAt: new Date("2026-10-18T10:00:05Z"),
  });
  harness.gateway.charges.set(chargeId, {
    id: chargeId,
    amount: 4900,
    amountRefunded: 0,
    currency: "usd",
    paymentIntentId: `pi_${subscription.id}`,
    applicationFeeId: feeId,
  });
  harness.gateway.fees.set(feeId, {
    id: feeId,
    accountId: paid.accountId,
    chargeId,
    amount: 98,
    amountRefunded: 0,
    currency: "usd",
    createdAt: new Date("2026-10-18T10:00:06Z"),
    refunds: [],
  });
  expect(
    await deliver(
      harness,
      "invoice.paid",
      { id: `in_${subscription.id}` },
      { account: paid.accountId },
    ),
  ).toEqual({ status: 200, outcome: "processed" });
  expect(
    await deliver(harness, "application_fee.created", { id: feeId, account: paid.accountId }),
  ).toEqual({ status: 200, outcome: "processed" });
  return { harness, paid, subscription, chargeId, feeId };
}

function setDispute(
  { harness, subscription, chargeId }: Paid,
  changes: Partial<GatewayDispute> = {},
): GatewayDispute {
  const dispute: GatewayDispute = {
    id: `dp_${subscription.id}`,
    chargeId,
    paymentIntentId: `pi_${subscription.id}`,
    amount: 4900,
    currency: "usd",
    status: "needs_response",
    createdAt: new Date("2026-10-25T08:00:00Z"),
    ...changes,
  };
  harness.gateway.disputes.set(dispute.id, dispute);
  return dispute;
}

function disputeEvent({ harness, paid }: Paid, type: string, dispute: GatewayDispute, id?: string) {
  return deliver(
    harness,
    type,
    { id: dispute.id, object: "dispute", status: "needs_response" },
    { account: paid.accountId, ...(id ? { id } : {}) },
  );
}

async function paymentOf(paid: PaidCommunity) {
  const [row] = await admin.db
    .select()
    .from(payments)
    .where(eq(payments.communityId, paid.communityId));
  return row ?? null;
}

async function ledgerOf(paid: PaidCommunity) {
  return admin.db
    .select()
    .from(feeLedgerEntries)
    .where(eq(feeLedgerEntries.communityId, paid.communityId))
    .orderBy(asc(feeLedgerEntries.createdAt), asc(feeLedgerEntries.id));
}

async function disputeNotices(paid: PaidCommunity) {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(
      and(eq(outbox.communityId, paid.communityId), eq(outbox.topic, paidMembershipEventsTopic)),
    );
  return rows
    .flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events)
    .filter((event) => event.type === "payments.payment_disputed");
}

describe("an open dispute", () => {
  it("marks the payment disputed, notifies the owner once, and keeps the member's access", async () => {
    const setup = await paidMember();
    const { harness, paid, subscription } = setup;
    const dispute = setDispute(setup);

    const created = await disputeEvent(setup, "charge.dispute.created", dispute, "evt_dp_created");
    const duplicate = await disputeEvent(
      setup,
      "charge.dispute.created",
      dispute,
      "evt_dp_created",
    );
    setDispute(setup, { status: "under_review" });
    const updated = await disputeEvent(setup, "charge.dispute.updated", dispute);

    expect(created).toEqual({ status: 200, outcome: "processed" });
    expect(duplicate).toEqual({ status: 200, outcome: "duplicate" });
    expect(updated).toEqual({ status: 200, outcome: "processed" });
    const payment = await paymentOf(paid);
    expect(payment).toMatchObject({
      disputeStatus: "open",
      disputedAt: new Date("2026-10-25T08:00:00Z"),
    });
    const notices = await disputeNotices(paid);
    expect(notices.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        communityId: paid.communityId,
        ownerId: paid.ownerId,
        amountMinor: 4900,
        currency: "usd",
      }),
    ]);
    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership?.status).toBe("active");
    const [mirror] = await admin.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.externalSubscriptionId, subscription.id));
    expect(mirror?.accessState).toBe("granted");
    expect(harness.gateway.writes("cancelSubscription")).toEqual([]);
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);
    expect((await ledgerOf(paid)).map((entry) => entry.kind)).toEqual(["fee_collected"]);
  });
});

describe("a closed dispute", () => {
  it("refunds the platform fee on the disputed amount once when the dispute is lost", async () => {
    const setup = await paidMember();
    const { harness, paid, feeId } = setup;
    const dispute = setDispute(setup);
    await disputeEvent(setup, "charge.dispute.created", dispute);
    setDispute(setup, { status: "lost", amount: 2450 });

    const closed = await disputeEvent(setup, "charge.dispute.closed", dispute);
    const redelivered = await disputeEvent(setup, "charge.dispute.closed", dispute);
    const feeRefunded = await deliver(harness, "application_fee.refunded", {
      id: feeId,
      account: paid.accountId,
    });

    expect(closed).toEqual({ status: 200, outcome: "processed" });
    expect(redelivered).toEqual({ status: 200, outcome: "processed" });
    expect(feeRefunded).toEqual({ status: 200, outcome: "processed" });
    const refunds = harness.gateway.writes("refundApplicationFee");
    expect(refunds.map((call) => [call.input, call.idempotencyKey])).toEqual([
      [{ feeId, amountMinor: 49, disputeId: dispute.id }, `fee-refund:dispute:${dispute.id}`],
    ]);
    const ledger = await ledgerOf(paid);
    expect(
      ledger.map((entry) => [entry.kind, entry.reason, entry.computedFeeMinor, entry.paymentId]),
    ).toEqual([
      ["fee_collected", null, 98, (await paymentOf(paid))?.id],
      ["fee_refunded", "dispute_lost", -49, (await paymentOf(paid))?.id],
    ]);
    expect((await paymentOf(paid))?.disputeStatus).toBe("lost");
    expect(await disputeNotices(paid)).toHaveLength(1);
  });

  it("converges when the closed event arrives before the created event", async () => {
    const setup = await paidMember();
    const { harness, paid, feeId } = setup;
    const dispute = setDispute(setup, { status: "lost" });

    await disputeEvent(setup, "charge.dispute.closed", dispute);
    await disputeEvent(setup, "charge.dispute.created", dispute);
    await disputeEvent(setup, "charge.dispute.funds_withdrawn", dispute);

    expect((await paymentOf(paid))?.disputeStatus).toBe("lost");
    expect(harness.gateway.writes("refundApplicationFee").map((call) => call.input)).toEqual([
      { feeId, amountMinor: 98, disputeId: dispute.id },
    ]);
    const refunded = (await ledgerOf(paid)).filter((entry) => entry.kind === "fee_refunded");
    expect(refunded.map((entry) => [entry.reason, entry.computedFeeMinor])).toEqual([
      ["dispute_lost", -98],
    ]);
    expect(await disputeNotices(paid)).toHaveLength(1);
  });

  it("keeps the fee and changes nothing else when the creator wins", async () => {
    const setup = await paidMember();
    const { harness, paid } = setup;
    const dispute = setDispute(setup);
    await disputeEvent(setup, "charge.dispute.created", dispute);
    setDispute(setup, { status: "won" });

    const closed = await disputeEvent(setup, "charge.dispute.closed", dispute);

    expect(closed).toEqual({ status: 200, outcome: "processed" });
    expect((await paymentOf(paid))?.disputeStatus).toBe("won");
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);
    expect((await ledgerOf(paid)).map((entry) => entry.kind)).toEqual(["fee_collected"]);
    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership?.status).toBe("active");
  });
});

describe("an early fraud warning", () => {
  it("is logged by charge id and changes nothing", async () => {
    const setup = await paidMember();
    const { harness, paid, chargeId } = setup;

    const result = await deliver(
      harness,
      "radar.early_fraud_warning.created",
      { id: "issfr_test", object: "radar.early_fraud_warning", charge: chargeId },
      { account: paid.accountId },
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    expect(harness.logs).toContainEqual(
      expect.objectContaining({ msg: "early fraud warning received", chargeId }),
    );
    expect((await paymentOf(paid))?.disputeStatus).toBeNull();
    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);
  });
});
