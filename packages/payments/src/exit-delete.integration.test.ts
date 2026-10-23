import {
  getMembership,
  runInCommunity,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import {
  communities,
  feeLedgerEntries,
  outbox,
  paymentConnections,
  paymentExitRuns,
  payments,
  platformBillingAccounts,
  platformInvoices,
} from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DeletionBlockedByBillingError,
  ExitInProgressError,
  ManualCancellationRequiredError,
} from "./errors";
import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import { prepareCommunityDeletion } from "./exit/kinds/delete";
import type { GatewaySubscription } from "./gateway";
import type { PaymentsJobs } from "./jobs";
import { cloudEnv, openProbeDb, openTestDb, user } from "./test/fixtures";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import {
  createHarness,
  mirrorSubscription,
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

const idleJobs: PaymentsJobs = {
  scheduleFeeRemoval: async () => {},
  scheduleExitRun: async () => {},
  scheduleMemberBillingEnd: async () => {},
  scheduleWebhookEvent: async () => {},
  scheduleBillingWebhookEvent: async () => {},
  scheduleConnectionReconcile: async () => {},
  scheduleRenewalReminder: async () => {},
};

async function paidCommunity(jobs: PaymentsJobs | null = null) {
  const harness = createHarness(probe.db, cloudEnv(), jobs);
  const paid = await setupPaidCommunity(admin.db, harness);
  await admin.db
    .update(communities)
    .set({ archivedAt: new Date("2026-10-19T10:00:00Z") })
    .where(eq(communities.id, paid.communityId));
  return { harness, paid };
}

function deliver(harness: Harness, paid: PaidCommunity, type: string, id: string) {
  const event = signedEvent(type, { id, object: "subscription" }, { account: paid.accountId });
  return harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
}

async function subscribe(
  harness: Harness,
  paid: PaidCommunity,
  userId: string,
): Promise<GatewaySubscription> {
  const subscription = stripeSubscription(paid, userId);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  const event = signedEvent(
    "checkout.session.completed",
    {
      id: `cs_${subscription.id}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: subscription.id,
      customer: subscription.customerId,
      client_reference_id: userId,
      metadata: subscription.metadata,
    },
    { account: paid.accountId },
  );
  const result = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
  expect(result.status).toBe(200);
  expect(["processed", "queued"]).toContain(result.outcome);
  return subscription;
}

async function payingMember(
  harness: Harness,
  communityId: CommunityId,
  input: Parameters<typeof mirrorSubscription>[2] = {},
) {
  const row = await mirrorSubscription(admin.db, communityId, input);
  harness.gateway.subscriptions.set(row.externalSubscriptionId, {
    id: row.externalSubscriptionId,
    status: "active",
    customerId: `cus_${row.id}`,
    metadata: {},
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    endedAt: null,
    interval: "month",
    applicationFeePercent: row.applicationFeeBps / 100,
    priceId: null,
  });
  return row;
}

async function seedPayment(communityId: CommunityId): Promise<string> {
  const [row] = await admin.db
    .insert(payments)
    .values({
      communityId,
      externalInvoiceId: `in_delete${crypto.randomUUID()}`,
      currency: "usd",
      amountMinor: 4900,
      occurredAt: new Date("2026-09-15T00:00:00Z"),
    })
    .returning({ id: payments.id });
  return row?.id ?? "";
}

async function seedFeeBalance(communityId: CommunityId, feeMinor: number): Promise<string> {
  const [row] = await admin.db
    .insert(feeLedgerEntries)
    .values({
      communityId,
      kind: "fee_accrued",
      provider: "stripe_own_keys",
      collectionMethod: "periodic_invoice",
      currency: "usd",
      baseMinor: feeMinor * 50,
      rateBps: 200,
      computedFeeMinor: feeMinor,
      idempotencyKey: `fee:delete:${crypto.randomUUID()}`,
      occurredAt: new Date("2026-10-10T00:00:00Z"),
    })
    .returning({ id: feeLedgerEntries.id });
  return row?.id ?? "";
}

async function seedInvoice(communityId: CommunityId, status: "open" | "paid"): Promise<void> {
  const [account] = await admin.db
    .insert(platformBillingAccounts)
    .values({ communityId })
    .returning({ id: platformBillingAccounts.id });
  await admin.db.insert(platformInvoices).values({
    communityId,
    billingAccountId: account?.id ?? "",
    currency: "usd",
    periodStart: new Date("2026-09-01T00:00:00Z"),
    periodEnd: new Date("2026-10-01T00:00:00Z"),
    amountMinor: 900,
    status,
    collectionMethod: "charge_automatically",
  });
}

function deleteCommunity(communityId: CommunityId, communityName: string) {
  return runInCommunity(withCommunity(probe.db, communityId), async (queries) => {
    const prepared = await prepareCommunityDeletion(queries, {
      communityName,
      now: new Date("2026-10-20T10:00:00Z"),
    });
    if (prepared.kind === "detached") {
      await queries.tx.delete(communities).where(eq(communities.id, communityId));
    }
    return prepared;
  });
}

async function runsOf(communityId: CommunityId) {
  return admin.db
    .select()
    .from(paymentExitRuns)
    .where(eq(paymentExitRuns.communityId, communityId));
}

async function detachedEvents(communityId: CommunityId): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(isNull(outbox.communityId), eq(outbox.topic, paidMembershipEventsTopic)));
  return rows
    .flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events)
    .filter((event) => event.payload.communityId === communityId);
}

function begin(harness: Harness, paid: PaidCommunity, overrides: object = {}) {
  return harness.service.beginDeletion({
    communityId: paid.communityId,
    actorId: paid.ownerId,
    includeLinked: true,
    confirmedManualCancellation: false,
    ...overrides,
  });
}

describe("deleting a community with paying members", () => {
  it("deletes at once and keeps financial records when nobody pays", async () => {
    const { harness, paid } = await paidCommunity();
    const paymentId = await seedPayment(paid.communityId);
    await seedInvoice(paid.communityId, "paid");

    expect(await begin(harness, paid)).toEqual({ kind: "ready" });
    expect(await harness.service.deletionReady(paid.communityId)).toBe(true);
    const prepared = await deleteCommunity(paid.communityId, "Paid circle");

    expect(prepared).toEqual({
      kind: "detached",
      detached: { payments: 1, ledgerEntries: 0, invoices: 1 },
    });
    const [payment] = await admin.db.select().from(payments).where(eq(payments.id, paymentId));
    expect(payment).toMatchObject({
      communityId: null,
      formerCommunityId: paid.communityId,
      formerCommunityName: "Paid circle",
    });
    expect(harness.gateway.writes("cancelSubscription")).toEqual([]);
  });

  it("cancels every active subscription without proration before the community goes", async () => {
    const { harness, paid } = await paidCommunity();
    const first = await payingMember(harness, paid.communityId);
    const linked = await payingMember(harness, paid.communityId, { origin: "linked_import" });
    await payingMember(harness, paid.communityId, { providerStatus: "canceled" });

    const start = await begin(harness, paid);

    expect(start.kind).toBe("queued");
    const [run] = await runsOf(paid.communityId);
    expect(run).toMatchObject({ kind: "delete", choice: "cancel_now", status: "done" });
    expect(run?.targetCount).toBe(2);
    const keys = harness.gateway.writes("cancelSubscription").map((call) => call.idempotencyKey);
    expect(keys.sort()).toEqual(
      [`exit:${run?.id}:${first.id}:cancel`, `exit:${run?.id}:${linked.id}:cancel`].sort(),
    );
    expect(harness.gateway.subscriptions.get(first.externalSubscriptionId)?.status).toBe(
      "canceled",
    );
    expect(await harness.service.deletionReady(paid.communityId)).toBe(true);
    expect((await deleteCommunity(paid.communityId, "Paid circle")).kind).toBe("detached");
  });

  it("keeps the community archived and reports the count when a cancel keeps failing", async () => {
    const { harness, paid } = await paidCommunity();
    const stuck = await payingMember(harness, paid.communityId);
    await payingMember(harness, paid.communityId);
    harness.gateway.failOn(
      "cancelSubscription",
      stuck.externalSubscriptionId,
      new Error("stripe is down"),
    );

    await begin(harness, paid);

    const summary = await harness.service.getPaidMembersSummary(
      user(paid.ownerId),
      paid.communityId,
    );
    expect(summary.run).toMatchObject({ kind: "delete", status: "failed", failedCount: 1 });
    expect(summary.run?.failedMembers.map((member) => member.userId)).toEqual([stuck.userId]);
    expect(await harness.service.deletionReady(paid.communityId)).toBe(false);
    expect(await deleteCommunity(paid.communityId, "Paid circle")).toEqual({ kind: "not_ready" });
    const [row] = await admin.db
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.id, paid.communityId));
    expect(row?.id).toBe(paid.communityId);
    expect(await detachedEvents(paid.communityId)).toEqual([]);
  });

  it("leaves linked imports running when the owner chose to", async () => {
    const { harness, paid } = await paidCommunity();
    const created = await payingMember(harness, paid.communityId);
    const linked = await payingMember(harness, paid.communityId, {
      origin: "linked_import",
      applicationFeeBps: 200,
    });

    await begin(harness, paid, { includeLinked: false });

    const cancelled = harness.gateway
      .writes("cancelSubscription")
      .map((call) => call.idempotencyKey);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatch(new RegExp(`:${created.id}:cancel$`));
    const linkedNow = harness.gateway.subscriptions.get(linked.externalSubscriptionId);
    expect(linkedNow?.status).toBe("active");
    expect(linkedNow?.applicationFeePercent).toBeNull();
    const changes = (await detachedEvents(paid.communityId)).flatMap((event) =>
      event.type === "paid_membership.changed"
        ? event.payload.recipients.map((recipient) => [event.payload.change, recipient.userId])
        : [],
    );
    expect(changes.sort()).toEqual(
      [
        ["billed_by_creator", linked.userId],
        ["community_deleted", created.userId],
      ].sort(),
    );
    expect(await harness.service.deletionReady(paid.communityId)).toBe(true);
  });

  it("asks for confirmation with the last known count when Stripe is disconnected", async () => {
    const { harness, paid } = await paidCommunity();
    await payingMember(harness, paid.communityId);
    await payingMember(harness, paid.communityId);
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: new Date("2026-10-19T12:00:00Z") })
      .where(eq(paymentConnections.communityId, paid.communityId));

    const refused = begin(harness, paid);
    await expect(refused).rejects.toBeInstanceOf(ManualCancellationRequiredError);
    await expect(refused).rejects.toMatchObject({ count: 2 });

    expect(await begin(harness, paid, { confirmedManualCancellation: true })).toEqual({
      kind: "ready",
    });
    const [run] = await runsOf(paid.communityId);
    expect(run).toMatchObject({ kind: "delete", status: "done", targetCount: 2 });
    expect(run?.manualCancellationConfirmedAt).toBeInstanceOf(Date);
    expect(harness.gateway.writes("cancelSubscription")).toEqual([]);
    expect((await deleteCommunity(paid.communityId, "Paid circle")).kind).toBe("detached");
  });

  it("emails members whose subscriptions the owner cancelled in the Stripe Dashboard", async () => {
    const { harness, paid } = await paidCommunity();
    const first = await payingMember(harness, paid.communityId);
    const second = await payingMember(harness, paid.communityId);
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: new Date("2026-10-19T12:00:00Z") })
      .where(eq(paymentConnections.communityId, paid.communityId));

    await begin(harness, paid, { confirmedManualCancellation: true });

    const events = await detachedEvents(paid.communityId);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type === "paid_membership.changed" && event.payload).toMatchObject({
      change: "community_deleted",
      actorId: paid.ownerId,
    });
    expect(
      event?.type === "paid_membership.changed" &&
        event.payload.recipients.map((recipient) => recipient.userId).sort(),
    ).toEqual([first.userId, second.userId].sort());
    await deleteCommunity(paid.communityId, "Paid circle");
    expect(await detachedEvents(paid.communityId)).toHaveLength(1);
  });

  it("asks to confirm a closed old connection next to a new one and emails both groups", async () => {
    const { harness, paid } = await paidCommunity();
    const old = await payingMember(harness, paid.communityId);
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: new Date("2026-10-19T12:00:00Z") })
      .where(eq(paymentConnections.communityId, paid.communityId));
    const [fresh] = await admin.db
      .insert(paymentConnections)
      .values({
        communityId: paid.communityId,
        provider: "stripe_connect",
        status: "active",
        externalAccountId: `acct_fresh${crypto.randomUUID()}`,
        chargesEnabled: true,
        detailsSubmitted: true,
        acceptedOwnerId: paid.ownerId,
      })
      .returning({ id: paymentConnections.id });
    const current = await payingMember(harness, paid.communityId, { connectionId: fresh?.id });

    const summary = await harness.service.getPaidMembersSummary(
      user(paid.ownerId),
      paid.communityId,
    );
    expect(summary).toMatchObject({ connection: "open", cohory: 1, manualCancellation: 1 });
    await expect(begin(harness, paid)).rejects.toMatchObject({ count: 1 });

    await begin(harness, paid, { confirmedManualCancellation: true });

    const recipients = (await detachedEvents(paid.communityId))
      .flatMap((event) =>
        event.type === "paid_membership.changed" && event.payload.change === "community_deleted"
          ? event.payload.recipients.map((recipient) => recipient.userId)
          : [],
      )
      .sort();
    expect(recipients).toEqual([old.userId, current.userId].sort());
    const after = await harness.service.getPaidMembersSummary(user(paid.ownerId), paid.communityId);
    expect(after.manualCancellation).toBe(0);
  });

  it("refuses deletion while a Cohory invoice is unpaid", async () => {
    const { harness, paid } = await paidCommunity();
    await seedInvoice(paid.communityId, "open");

    const refused = begin(harness, paid);
    await expect(refused).rejects.toBeInstanceOf(DeletionBlockedByBillingError);
    await expect(refused).rejects.toMatchObject({ reason: "unpaid_invoice" });
    await expect(deleteCommunity(paid.communityId, "Paid circle")).rejects.toBeInstanceOf(
      DeletionBlockedByBillingError,
    );
    expect(await runsOf(paid.communityId)).toEqual([]);
  });

  it("writes off a fee balance below the invoice minimum and lets deletion proceed", async () => {
    const { harness, paid } = await paidCommunity();
    const accrued = await seedFeeBalance(paid.communityId, 49);

    expect(await begin(harness, paid)).toEqual({ kind: "ready" });
    const prepared = await deleteCommunity(paid.communityId, "Paid circle");

    expect(prepared).toMatchObject({ kind: "detached", detached: { ledgerEntries: 2 } });
    const entries = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.formerCommunityId, paid.communityId));
    const writeOff = entries.find((entry) => entry.id !== accrued);
    expect(writeOff).toMatchObject({
      kind: "adjustment",
      computedFeeMinor: -49,
      currency: "usd",
      externalRef: "community_deleted_below_minimum",
      idempotencyKey: `fee:written_off:${paid.communityId}:usd`,
      communityId: null,
      formerCommunityName: "Paid circle",
    });
  });

  it("refuses deletion while a fee balance can still be invoiced", async () => {
    const { harness, paid } = await paidCommunity();
    await seedFeeBalance(paid.communityId, 600);

    await expect(begin(harness, paid)).rejects.toMatchObject({
      code: "deletion_blocked_billing",
      reason: "open_balance",
    });
  });

  it("keeps members' access while their subscriptions are being cancelled", async () => {
    const { harness, paid } = await paidCommunity(idleJobs);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    expect((await begin(harness, paid)).kind).toBe("queued");

    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });
    expect(await deliver(harness, paid, "customer.subscription.deleted", subscription.id)).toEqual({
      status: 200,
      outcome: "queued",
    });

    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership?.status).toBe("active");
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.access.level).toBe("member");
  });

  it("removes the deferred memberships when the delete run fails", async () => {
    const { harness, paid } = await paidCommunity(idleJobs);
    const leaving = await subscribe(harness, paid, paid.buyerId);
    const stuck = await subscribe(harness, paid, paid.memberId);
    harness.gateway.failOn("cancelSubscription", stuck.id, new Error("stripe is down"));
    await begin(harness, paid);
    harness.gateway.subscriptions.set(leaving.id, { ...leaving, status: "canceled" });
    await deliver(harness, paid, "customer.subscription.deleted", leaving.id);
    await admin.db
      .update(paymentExitRuns)
      .set({ attempts: 7 })
      .where(eq(paymentExitRuns.communityId, paid.communityId));
    const [run] = await runsOf(paid.communityId);

    const result = await harness.service.runExitRun({
      runId: run?.id ?? "",
      communityId: paid.communityId,
    });

    expect(result.status).toBe("failed");
    const buyer = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(buyer?.status).not.toBe("active");
    const member = await getMembership(withCommunity(admin.db, paid.communityId), paid.memberId);
    expect(member?.status).toBe("active");
  });

  it("emails members after their subscriptions are cancelled and before the community is deleted", async () => {
    const { harness, paid } = await paidCommunity();
    const member = await payingMember(harness, paid.communityId);

    await begin(harness, paid);

    const events = await detachedEvents(paid.communityId);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type === "paid_membership.changed" && event.payload).toMatchObject({
      change: "community_deleted",
      actorId: paid.ownerId,
      recipients: [{ userId: member.userId, endsAt: null }],
    });
    const [community] = await admin.db
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.id, paid.communityId));
    expect(community?.id).toBe(paid.communityId);
    await deleteCommunity(paid.communityId, "Paid circle");
    expect(await detachedEvents(paid.communityId)).toHaveLength(1);
  });

  it("refuses a second delete while the first is running", async () => {
    const { harness, paid } = await paidCommunity(idleJobs);
    await payingMember(harness, paid.communityId);

    expect((await begin(harness, paid)).kind).toBe("queued");
    await expect(begin(harness, paid)).rejects.toBeInstanceOf(ExitInProgressError);
    await expect(
      harness.service.beginArchive({
        communityId: paid.communityId,
        actorId: paid.ownerId,
        choice: "stop_at_period_end",
        includeLinked: true,
      }),
    ).rejects.toBeInstanceOf(ExitInProgressError);
    expect(harness.gateway.writes("cancelSubscription")).toEqual([]);
    expect(await runsOf(paid.communityId)).toHaveLength(1);
  });
});
