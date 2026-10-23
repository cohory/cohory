import { ForbiddenError } from "@cohory/authz";
import { getMembership, withCommunity, type Database } from "@cohory/db";
import {
  feeLedgerEntries,
  memberships,
  outbox,
  paymentConnections,
  paymentExitRuns,
  payments,
  providerEvents,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { GatewaySubscription } from "./gateway";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { eventLeaseMs } from "./service/webhooks";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
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

async function membershipOf(paid: PaidCommunity, userId: string) {
  return getMembership(withCommunity(admin.db, paid.communityId), userId);
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

function deliver(
  harness: Harness,
  type: string,
  object: Record<string, unknown> & { id: string },
  options: { account?: string | null; secret?: string; livemode?: boolean; id?: string } = {},
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

async function subscribe(
  harness: Harness,
  paid: PaidCommunity,
  userId: string,
  overrides: Partial<GatewaySubscription> = {},
): Promise<GatewaySubscription> {
  const subscription = stripeSubscription(paid, userId, overrides);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  const result = await deliver(
    harness,
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
  expect(result.status).toBe(200);
  expect(["processed", "queued"]).toContain(result.outcome);
  return subscription;
}

async function setStatus(
  harness: Harness,
  paid: PaidCommunity,
  subscription: GatewaySubscription,
  changes: Partial<GatewaySubscription>,
  type = "customer.subscription.updated",
) {
  const next = { ...subscription, ...changes };
  harness.gateway.subscriptions.set(subscription.id, next);
  harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
  return deliver(
    harness,
    type,
    { id: subscription.id, object: "subscription" },
    { account: paid.accountId },
  );
}

describe("checkout completion", () => {
  it("links the subscription to the buyer and grants a membership", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    const subscription = await subscribe(harness, paid, paid.buyerId);

    expect(await subscriptionRow(subscription.id)).toMatchObject({
      userId: paid.buyerId,
      providerStatus: "active",
      accessState: "granted",
      interval: "month",
      planId: paid.planId,
      applicationFeeBps: 200,
      cancelAtPeriodEnd: false,
    });
    expect(await membershipOf(paid, paid.buyerId)).toMatchObject({
      status: "active",
      role: "member",
    });
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(true);
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine).toMatchObject({
      access: { level: "member", source: "subscription", state: "granted" },
      canManageBilling: true,
    });
    const portal = await harness.service.createPortalSession(user(paid.buyerId), paid.communityId);
    expect(portal.url).toBe(`https://billing.stripe.test/${subscription.customerId}`);
  });

  it("does not grant access for an incomplete subscription", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    await subscribe(harness, paid, paid.buyerId, { status: "incomplete" });

    expect(await membershipOf(paid, paid.buyerId)).toBeNull();
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.access).toEqual({ level: "payment_required", reason: "incomplete" });
  });

  it("blocks a second checkout for an active subscriber", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await subscribe(harness, paid, paid.buyerId);

    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow("member already has an active subscription");
  });

  it("ignores metadata that points at another community", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const other = await insertCommunity(admin.db);
    const subscription = stripeSubscription(paid, paid.buyerId, {
      metadata: { cohory_community_id: other, cohory_user_id: paid.buyerId },
    });
    harness.gateway.subscriptions.set(subscription.id, subscription);

    const result = await deliver(
      harness,
      "customer.subscription.created",
      { id: subscription.id },
      { account: paid.accountId },
    );

    expect(result.status).toBe(200);
    expect(await subscriptionRow(subscription.id)).toBeNull();
  });
});

describe("subscription status transitions", () => {
  const table: [
    string,
    Partial<GatewaySubscription>,
    "granted" | "grace" | "revoked" | "none",
    "active" | "removed",
  ][] = [
    ["past due keeps access", { status: "past_due" }, "grace", "active"],
    ["cancel at period end keeps access", { cancelAtPeriodEnd: true }, "granted", "active"],
    ["unpaid removes access", { status: "unpaid" }, "revoked", "removed"],
    [
      "canceled removes access",
      { status: "canceled", endedAt: new Date("2026-11-18T10:00:00Z") },
      "revoked",
      "removed",
    ],
    ["paused keeps access through the paid period", { status: "paused" }, "granted", "active"],
    [
      "paused removes access after the paid period",
      { status: "paused", currentPeriodEnd: new Date("2026-10-01T10:00:00.000Z") },
      "revoked",
      "removed",
    ],
    ["incomplete expired removes access", { status: "incomplete_expired" }, "none", "removed"],
  ];

  it.each(table)("%s", async (_, changes, accessState, membershipStatus) => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);

    const result = await setStatus(harness, paid, subscription, changes);

    expect(result).toEqual({ status: 200, outcome: "processed" });
    expect(await subscriptionRow(subscription.id)).toMatchObject({ accessState });
    expect((await membershipOf(paid, paid.buyerId))?.status).toBe(membershipStatus);
  });

  it("restores access when a past due subscription is paid again", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    await setStatus(harness, paid, subscription, { status: "past_due" });
    await setStatus(harness, paid, subscription, { status: "unpaid" });
    expect((await membershipOf(paid, paid.buyerId))?.status).toBe("removed");

    await setStatus(harness, paid, subscription, { status: "active" });

    expect((await membershipOf(paid, paid.buyerId))?.status).toBe("active");
  });

  it("removes access on customer.subscription.deleted", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);

    await setStatus(
      harness,
      paid,
      subscription,
      { status: "canceled" },
      "customer.subscription.deleted",
    );

    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(false);
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.access).toEqual({ level: "payment_required", reason: "ended" });
  });

  it("keeps a comped member when their old subscription ends", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    await harness.service.grantComp(user(paid.ownerId), paid.communityId, {
      userId: paid.buyerId,
    });

    await setStatus(
      harness,
      paid,
      subscription,
      { status: "canceled" },
      "customer.subscription.deleted",
    );

    expect((await membershipOf(paid, paid.buyerId))?.status).toBe("active");
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.access).toEqual({ level: "member", source: "comp", expiresAt: null });
  });

  it("never removes staff and never reactivates a banned person", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const moderatorId = await insertMember(admin.db, paid.communityId, "moderator");
    const staffSub = await subscribe(harness, paid, moderatorId);
    await setStatus(harness, paid, staffSub, { status: "canceled" });
    expect((await membershipOf(paid, moderatorId))?.status).toBe("active");

    const bannedId = await insertMember(admin.db, paid.communityId, "member", "banned");
    await subscribe(harness, paid, bannedId);
    expect((await membershipOf(paid, bannedId))?.status).toBe("banned");
  });

  it("refuses checkout and activation for an address banned in the community", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const formerId = await insertMember(admin.db, paid.communityId, "member", "banned");
    const [buyer] = await admin.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, paid.buyerId));
    await admin.db
      .update(memberships)
      .set({ bannedEmail: buyer?.email ?? "" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, formerId)));

    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await subscribe(harness, paid, paid.buyerId);
    expect(await membershipOf(paid, paid.buyerId)).toBeNull();
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(false);
  });

  it("links the buyer from invoice.paid when it arrives before checkout.session.completed", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    harness.gateway.invoices.set("in_first" + subscription.id, {
      id: "in_first" + subscription.id,
      subscriptionId: subscription.id,
      status: "paid",
      amountPaid: 4900,
      amountDue: 4900,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 0,
      currency: "usd",
      paymentIntentIds: ["pi_first" + subscription.id],
      paidAt: new Date("2026-10-18T10:00:05Z"),
    });

    const invoice = await deliver(
      harness,
      "invoice.paid",
      { id: "in_first" + subscription.id },
      { account: paid.accountId },
    );
    const checkout = await subscribe(harness, paid, paid.buyerId, subscription);

    expect(invoice).toEqual({ status: 200, outcome: "processed" });
    expect(checkout.id).toBe(subscription.id);
    expect(await membershipOf(paid, paid.buyerId)).toMatchObject({ status: "active" });
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.communityId, paid.communityId));
    expect(payment).toMatchObject({ amountMinor: 4900 });
    const rows = await admin.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.externalSubscriptionId, subscription.id));
    expect(rows).toHaveLength(1);
  });

  it("creates the mirror from customer.subscription.updated when created never arrived", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId, { status: "past_due" });
    harness.gateway.subscriptions.set(subscription.id, subscription);

    const result = await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id },
      { account: paid.accountId },
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    expect(await subscriptionRow(subscription.id)).toMatchObject({
      providerStatus: "past_due",
      accessState: "grace",
    });
    expect(await membershipOf(paid, paid.buyerId)).toMatchObject({ status: "active" });
  });

  it("derives state from the fetched object so out of order events converge", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });

    await deliver(
      harness,
      "customer.subscription.created",
      { id: subscription.id },
      { account: paid.accountId },
    );
    await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id },
      { account: paid.accountId },
    );

    expect(await subscriptionRow(subscription.id)).toMatchObject({ providerStatus: "canceled" });
  });
});

describe("idempotency and verification", () => {
  it("applies the same event once and answers duplicates with 200", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "past_due" });
    const event = signedEvent(
      "customer.subscription.updated",
      { id: subscription.id },
      { account: paid.accountId },
    );
    const request = { rawBody: event.rawBody, signature: event.signature };
    const fetchesBefore = harness.gateway.writes("retrieveSubscription").length;

    const first = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );
    const second = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(first).toEqual({ status: 200, outcome: "processed" });
    expect(second).toEqual({ status: 200, outcome: "duplicate" });
    expect(harness.gateway.writes("retrieveSubscription").length - fetchesBefore).toBe(1);
    const rows = await admin.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.externalEventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempts: 1,
      communityId: paid.communityId,
      type: "customer.subscription.updated",
    });
    expect(rows[0]?.processedAt).not.toBeNull();
  });

  it("retries an event whose first attempt failed", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    const event = signedEvent(
      "customer.subscription.created",
      { id: subscription.id },
      { account: paid.accountId },
    );
    const request = { rawBody: event.rawBody, signature: event.signature };

    const failed = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const retried = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(failed).toEqual({ status: 500, outcome: "failed" });
    expect(retried).toEqual({ status: 200, outcome: "processed" });
    expect(harness.logs.some((entry) => entry["msg"] === "stripe webhook processing failed")).toBe(
      true,
    );
  });

  it("records an event type it does not handle and answers 200", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const event = signedEvent("payout.paid", { id: "po_recorded" }, { account: paid.accountId });

    const result = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery({
        rawBody: event.rawBody,
        signature: event.signature,
      }),
    );

    expect(result).toEqual({ status: 200, outcome: "ignored" });
    const [row] = await admin.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.externalEventId, event.id));
    expect(row).toMatchObject({ type: "payout.paid", communityId: paid.communityId });
    expect(row?.processedAt).not.toBeNull();
  });

  it("keeps an event claimed for the lease and lets it be reclaimed after it expires", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const repo = createPostgresPaymentsRepository(probe.db);
    const now = harness.clock.now;
    const connection = await repo.findConnectionByAccount(paid.accountId);
    const input = {
      provider: "stripe_connect" as const,
      externalEventId: `evt_lease_${paid.communityId}`,
      externalAccountId: paid.accountId,
      connectionId: connection?.id ?? null,
      type: "customer.subscription.updated",
      livemode: false,
      payloadHash: "0".repeat(64),
    };

    const recorded = await repo.recordEvent({ ...input, now });
    const again = await repo.recordEvent({ ...input, now });
    const first = await repo.claimEvent(recorded.rowId, now, eventLeaseMs);
    const concurrent = await repo.claimEvent(
      recorded.rowId,
      new Date(now.getTime() + 1000),
      eventLeaseMs,
    );
    const expired = await repo.claimEvent(
      recorded.rowId,
      new Date(now.getTime() + eventLeaseMs + 1),
      eventLeaseMs,
    );

    expect(again).toEqual(recorded);
    expect(first.kind).toBe("claimed");
    expect(concurrent).toEqual({ kind: "in_progress" });
    expect(expired.kind).toBe("claimed");
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const event = signedEvent(
      "customer.subscription.updated",
      { id: subscription.id },
      { account: paid.accountId, id: input.externalEventId },
    );
    expect(
      await harness.service.handleWebhook(
        { setup: "platform_account" },
        stripeDelivery({
          rawBody: event.rawBody,
          signature: event.signature,
        }),
      ),
    ).toEqual({ status: 409, outcome: "in_progress" });
  });

  it("cannot touch another community's rows from a connected account's event", async () => {
    const harness = createHarness(probe.db);
    const a = await setupPaidCommunity(admin.db, harness);
    const b = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(b, b.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);

    const result = await deliver(
      harness,
      "customer.subscription.created",
      { id: subscription.id },
      { account: a.accountId },
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    expect(await subscriptionRow(subscription.id)).toBeNull();
    expect(await membershipOf(b, b.buyerId)).toBeNull();
    expect(await membershipOf(a, b.buyerId)).toBeNull();
    expect(await harness.service.listSubscriptions(user(b.adminId), b.communityId)).toEqual([]);
    const [row] = await admin.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.externalAccountId, a.accountId));
    expect(row?.communityId).toBe(a.communityId);
  });

  it("rejects bad signatures and unsigned requests", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const event = signedEvent(
      "customer.subscription.updated",
      { id: "sub_x" },
      {
        account: paid.accountId,
        secret: "whsec_wrong",
      },
    );

    expect(
      await harness.service.handleWebhook(
        { setup: "platform_account" },
        stripeDelivery({
          rawBody: event.rawBody,
          signature: event.signature,
        }),
      ),
    ).toEqual({ status: 400, outcome: "invalid_signature" });
    expect(
      await harness.service.handleWebhook(
        { setup: "platform_account" },
        stripeDelivery({ rawBody: event.rawBody, signature: null }),
      ),
    ).toEqual({
      status: 400,
      outcome: "invalid_signature",
    });
  });

  it("acknowledges events for unknown accounts and the wrong mode without processing them", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    expect(
      await deliver(
        harness,
        "customer.subscription.updated",
        { id: "sub_x" },
        { account: "acct_unknown" },
      ),
    ).toEqual({ status: 200, outcome: "unknown_connection" });
    expect(
      await deliver(
        harness,
        "customer.subscription.updated",
        { id: "sub_x" },
        { account: paid.accountId, livemode: true },
      ),
    ).toEqual({ status: 200, outcome: "ignored" });
    expect(
      await deliver(harness, "payout.paid", { id: "po_1" }, { account: paid.accountId }),
    ).toEqual({
      status: 200,
      outcome: "ignored",
    });
  });

  it("is unavailable until webhook secrets are configured", async () => {
    const harness = createHarness(probe.db, cloudEnv({ webhookSecrets: [] }));
    const event = signedEvent("invoice.paid", { id: "in_1" });
    expect(
      await harness.service.handleWebhook(
        { setup: "platform_account" },
        stripeDelivery({
          rawBody: event.rawBody,
          signature: event.signature,
        }),
      ),
    ).toEqual({ status: 503, outcome: "not_configured" });
  });
});

describe("payments and the fee ledger", () => {
  async function paidInvoice(
    harness: Harness,
    paid: PaidCommunity,
    subscription: GatewaySubscription,
    amounts: { readonly chargeMinor: number; readonly feeMinor: number } = {
      chargeMinor: 4900,
      feeMinor: 98,
    },
  ) {
    harness.gateway.invoices.set("in_1" + subscription.id, {
      id: "in_1" + subscription.id,
      subscriptionId: subscription.id,
      status: "paid",
      amountPaid: amounts.chargeMinor,
      amountDue: amounts.chargeMinor,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 0,
      currency: "usd",
      paymentIntentIds: ["pi_" + subscription.id],
      paidAt: new Date("2026-10-18T10:00:05Z"),
    });
    harness.gateway.charges.set("ch_" + subscription.id, {
      id: "ch_" + subscription.id,
      amount: amounts.chargeMinor,
      amountRefunded: 0,
      currency: "usd",
      paymentIntentId: "pi_" + subscription.id,
      applicationFeeId: "fee_" + subscription.id,
    });
    harness.gateway.fees.set("fee_" + subscription.id, {
      id: "fee_" + subscription.id,
      accountId: paid.accountId,
      chargeId: "ch_" + subscription.id,
      amount: amounts.feeMinor,
      amountRefunded: 0,
      currency: "usd",
      createdAt: new Date("2026-10-18T10:00:06Z"),
      refunds: [],
    });
    expect(
      await deliver(
        harness,
        "invoice.paid",
        { id: "in_1" + subscription.id },
        { account: paid.accountId },
      ),
    ).toEqual({ status: 200, outcome: "processed" });
    expect(
      await deliver(harness, "application_fee.created", {
        id: "fee_" + subscription.id,
        account: paid.accountId,
      }),
    ).toEqual({ status: 200, outcome: "processed" });
  }

  it("records the payment and one fee_collected entry with both figures", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);

    await paidInvoice(harness, paid, subscription);
    await deliver(harness, "application_fee.created", {
      id: "fee_" + subscription.id,
      account: paid.accountId,
    });

    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.communityId, paid.communityId));
    expect(payment).toMatchObject({ amountMinor: 4900, currency: "usd", refundedMinor: 0 });
    const ledger = await ledgerOf(paid);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "fee_collected",
      provider: "stripe_connect",
      collectionMethod: "automatic_split",
      baseMinor: 4900,
      rateBps: 200,
      computedFeeMinor: 98,
      providerFeeMinor: 98,
      externalRef: "fee_" + subscription.id,
      paymentId: payment?.id,
      idempotencyKey: `fee:collected:fee_${subscription.id}`,
    });
  });

  it("records fee_collected at the subscription's own rate when it predates a rate change", async () => {
    const harness = createHarness(probe.db, cloudEnv({ platformFeeBps: 250 }));
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId, {
      applicationFeePercent: 2,
    });

    await paidInvoice(harness, paid, subscription, { chargeMinor: 29_000, feeMinor: 580 });

    const [entry] = await ledgerOf(paid);
    expect(entry).toMatchObject({ kind: "fee_collected", rateBps: 200, computedFeeMinor: 580 });
    expect(
      harness.logs.some((line) => line["msg"] === "application fee differs from computed fee"),
    ).toBe(false);
  });

  it("records fee_collected at the configured rate for a new subscription", async () => {
    const harness = createHarness(probe.db, cloudEnv({ platformFeeBps: 200 }));
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId, {
      applicationFeePercent: 2,
    });

    await paidInvoice(harness, paid, subscription, { chargeMinor: 29_000, feeMinor: 580 });

    const [entry] = await ledgerOf(paid);
    expect(entry).toMatchObject({ kind: "fee_collected", rateBps: 200, computedFeeMinor: 580 });
  });

  it("refunds the platform fee proportionally when the creator refunds part of a charge", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    await paidInvoice(harness, paid, subscription);
    const chargeId = "ch_" + subscription.id;
    const charge = harness.gateway.charges.get(chargeId);
    harness.gateway.charges.set(chargeId, {
      ...(charge ?? {
        id: chargeId,
        amount: 4900,
        currency: "usd",
        paymentIntentId: null,
        applicationFeeId: null,
      }),
      amountRefunded: 2450,
    });

    await deliver(harness, "charge.refunded", { id: chargeId }, { account: paid.accountId });
    await deliver(harness, "charge.refunded", { id: chargeId }, { account: paid.accountId });
    await deliver(harness, "application_fee.refunded", {
      id: "fee_" + subscription.id,
      account: paid.accountId,
    });

    const refunds = harness.gateway.writes("refundApplicationFee");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.input).toEqual({ feeId: "fee_" + subscription.id, amountMinor: 49 });
    const ledger = await ledgerOf(paid);
    expect(
      ledger.map((entry) => [entry.kind, entry.computedFeeMinor, entry.providerFeeMinor]),
    ).toEqual([
      ["fee_collected", 98, 98],
      ["fee_refunded", -49, -49],
    ]);
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.communityId, paid.communityId));
    expect(payment?.refundedMinor).toBe(2450);

    const summary = await harness.service.getLedgerSummary(user(paid.adminId), paid.communityId);
    expect(summary).toEqual({
      edition: "cloud",
      platformFeeBps: 200,
      currencies: [
        {
          currency: "usd",
          paymentCount: 1,
          grossMinor: 4900,
          refundedMinor: 2450,
          taxMinor: 0,
          platformFeeMinor: 98,
          platformFeeRefundedMinor: 49,
          netPlatformFeeMinor: 49,
        },
      ],
    });
  });

  it("lists subscriptions for managers only", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await subscribe(harness, paid, paid.buyerId);

    const list = await harness.service.listSubscriptions(user(paid.adminId), paid.communityId);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userId: paid.buyerId,
      providerStatus: "active",
      accessState: "granted",
    });
    await expect(
      harness.service.listSubscriptions(user(paid.memberId), paid.communityId),
    ).rejects.toThrow();
    await expect(
      harness.service.getLedgerSummary(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow();
  });
});

describe("own keys webhooks on the Community Edition", () => {
  it("verifies with the connection's own secret and writes no fee entries", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const buyerId = await insertUser(admin.db);
    const connection = await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "sk_test_ownhook",
      webhookSecret: "whsec_ownhook",
    });
    const plan = await harness.service.upsertPlan(user(ownerId), communityId, {
      currency: "usd",
      monthlyPriceMinor: 900,
    });
    const paid: PaidCommunity = {
      communityId,
      accountId: connection.externalAccountId ?? "",
      connectionId: connection.id,
      ownerId,
      adminId: ownerId,
      memberId: ownerId,
      buyerId,
      planId: plan.id,
    };
    const subscription = stripeSubscription(paid, buyerId, { applicationFeePercent: null });
    harness.gateway.subscriptions.set(subscription.id, subscription);

    const wrong = signedEvent(
      "customer.subscription.created",
      { id: subscription.id },
      { secret: "whsec_connect" },
    );
    const right = signedEvent(
      "customer.subscription.created",
      { id: subscription.id },
      { secret: "whsec_ownhook" },
    );

    expect(
      await harness.service.handleWebhook(
        { setup: "own_keys", connectionId: connection.id },
        stripeDelivery({
          rawBody: wrong.rawBody,
          signature: wrong.signature,
        }),
      ),
    ).toEqual({ status: 400, outcome: "invalid_signature" });
    expect(
      await harness.service.handleWebhook(
        { setup: "own_keys", connectionId: connection.id },
        stripeDelivery({
          rawBody: right.rawBody,
          signature: right.signature,
        }),
      ),
    ).toEqual({ status: 200, outcome: "processed" });
    expect(await harness.service.hasActiveMembership(communityId, buyerId)).toBe(true);
    expect(await subscriptionRow(subscription.id)).toMatchObject({ applicationFeeBps: 0 });

    const fee = signedEvent(
      "application_fee.created",
      { id: "fee_x" },
      { secret: "whsec_ownhook" },
    );
    expect(
      await harness.service.handleWebhook(
        { setup: "own_keys", connectionId: connection.id },
        stripeDelivery({
          rawBody: fee.rawBody,
          signature: fee.signature,
        }),
      ),
    ).toEqual({ status: 200, outcome: "processed" });
    const ledger = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.communityId, communityId));
    expect(ledger).toEqual([]);
    expect(
      await harness.service.handleWebhook(
        { setup: "own_keys", connectionId: "not-a-uuid" },
        stripeDelivery({
          rawBody: right.rawBody,
          signature: right.signature,
        }),
      ),
    ).toEqual({ status: 404, outcome: "unknown_connection" });
  });
});

describe("after the creator leaves", () => {
  const run = crypto.randomUUID().slice(0, 8);
  function exitFee(paid: PaidCommunity, harness: Harness, feeId: string, amount = 98) {
    harness.gateway.fees.set(feeId, {
      id: feeId,
      accountId: paid.accountId,
      chargeId: `ch_${feeId}`,
      amount,
      amountRefunded: 0,
      currency: "usd",
      createdAt: new Date("2026-10-19T10:00:00Z"),
      refunds: [],
    });
  }

  function feeEvent(
    harness: Harness,
    paid: PaidCommunity,
    type: "application_fee.created" | "application_fee.refunded",
    feeId: string,
    id?: string,
  ) {
    return deliver(
      harness,
      type,
      { id: feeId, object: "application_fee", account: paid.accountId },
      id ? { id } : {},
    );
  }

  async function disconnected(jobs: Parameters<typeof createHarness>[2] = null) {
    const harness = createHarness(probe.db, cloudEnv(), jobs);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const subscription = await subscribe(harness, paid, paid.buyerId);
    return { harness, paid, subscription };
  }

  async function connectionRow(paid: PaidCommunity) {
    const [row] = await admin.db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.externalAccountId, paid.accountId));
    return row ?? null;
  }

  async function noticesOf(paid: PaidCommunity): Promise<PaidMembershipEvent[]> {
    const rows = await admin.db
      .select({ payload: outbox.payload })
      .from(outbox)
      .where(
        and(eq(outbox.communityId, paid.communityId), eq(outbox.topic, paidMembershipEventsTopic)),
      );
    return rows.flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events);
  }

  function expectExitLedger(ledger: Awaited<ReturnType<typeof ledgerOf>>, feeId: string) {
    expect(
      ledger.map((entry) => [
        entry.kind,
        entry.baseMinor,
        entry.rateBps,
        entry.computedFeeMinor,
        entry.providerFeeMinor,
      ]),
    ).toEqual([
      ["fee_collected", 0, 0, 0, 98],
      ["fee_refunded", 0, 0, 0, -98],
    ]);
    expect(ledger[0]?.idempotencyKey).toBe(`fee:collected:${feeId}`);
    expect(ledger[1]?.idempotencyKey).toMatch(/^fee:refunded:fr_/);
  }

  it("refunds an application fee created after the owner disconnected", async () => {
    const { harness, paid } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    exitFee(paid, harness, `fee_after_exit_${run}`);

    const result = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_after_exit_${run}`,
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    const refunds = harness.gateway.writes("refundApplicationFee");
    expect(refunds).toEqual([
      expect.objectContaining({
        idempotencyKey: `exit-fee-refund:fee_after_exit_${run}`,
        input: { feeId: `fee_after_exit_${run}`, amountMinor: 98 },
      }),
    ]);
    expectExitLedger(await ledgerOf(paid), `fee_after_exit_${run}`);
  });

  it("refunds a fee created while the connection is disconnecting", async () => {
    const { harness, paid } = await disconnected();
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnecting" })
      .where(eq(paymentConnections.externalAccountId, paid.accountId));
    exitFee(paid, harness, `fee_while_leaving_${run}`);

    const result = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_while_leaving_${run}`,
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    expect(harness.gateway.writes("refundApplicationFee")).toHaveLength(1);
    expectExitLedger(await ledgerOf(paid), `fee_while_leaving_${run}`);
  });

  it("refunds once when the same fee event arrives twice", async () => {
    const { harness, paid } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    exitFee(paid, harness, `fee_twice_${run}`);

    const first = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_twice_${run}`,
      `evt_fee_1_${run}`,
    );
    const again = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_twice_${run}`,
      `evt_fee_1_${run}`,
    );
    const redelivered = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_twice_${run}`,
      `evt_fee_2_${run}`,
    );

    expect(first.outcome).toBe("processed");
    expect(again).toEqual({ status: 200, outcome: "duplicate" });
    expect(redelivered.outcome).toBe("processed");
    expect(harness.gateway.writes("refundApplicationFee")).toHaveLength(1);
    expectExitLedger(await ledgerOf(paid), `fee_twice_${run}`);
  });

  it("refunds once when application_fee.refunded arrives before created", async () => {
    const { harness, paid } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    exitFee(paid, harness, `fee_reordered_${run}`);

    const refunded = await feeEvent(
      harness,
      paid,
      "application_fee.refunded",
      `fee_reordered_${run}`,
    );
    const created = await feeEvent(
      harness,
      paid,
      "application_fee.created",
      `fee_reordered_${run}`,
    );

    expect([refunded.outcome, created.outcome]).toEqual(["processed", "processed"]);
    expect(harness.gateway.writes("refundApplicationFee")).toHaveLength(1);
    expectExitLedger(await ledgerOf(paid), `fee_reordered_${run}`);
  });

  it("leaves a fee for another account alone", async () => {
    const { harness, paid } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    exitFee(paid, harness, `fee_elsewhere_${run}`);
    const fee = harness.gateway.fees.get(`fee_elsewhere_${run}`);
    if (fee) harness.gateway.fees.set(`fee_elsewhere_${run}`, { ...fee, accountId: "acct_other" });

    await feeEvent(harness, paid, "application_fee.created", `fee_elsewhere_${run}`);

    expect(harness.gateway.writes("refundApplicationFee")).toEqual([]);
    expect(await ledgerOf(paid)).toEqual([]);
  });

  it("closes the connection on deauthorization and notifies owner and members once", async () => {
    const scheduled: unknown[] = [];
    const { harness, paid, subscription } = await disconnected({
      scheduleFeeRemoval: async () => {
        throw new Error("deauthorization must not schedule the old fee removal job");
      },
      scheduleExitRun: async (payload) => {
        scheduled.push(payload);
      },
      scheduleMemberBillingEnd: async () => {},
      scheduleWebhookEvent: async () => {},
      scheduleBillingWebhookEvent: async () => {},
      scheduleConnectionReconcile: async () => {},
      scheduleRenewalReminder: async () => {},
    });
    await harness.service.beginArchive({
      communityId: paid.communityId,
      actorId: paid.ownerId,
      choice: "stop_at_period_end",
      includeLinked: true,
    });
    const deauthorized = () =>
      deliver(
        harness,
        "account.application.deauthorized",
        { id: "ca_test_app", object: "application" },
        { account: paid.accountId },
      );

    const result = await deauthorized();
    const again = await deauthorized();

    expect(result).toEqual({ status: 200, outcome: "queued" });
    expect(again).toEqual({ status: 200, outcome: "queued" });
    const connection = await connectionRow(paid);
    expect(connection?.status).toBe("disconnected");
    expect(connection?.disconnectedAt).not.toBeNull();
    expect(await harness.service.getPlan(user(paid.ownerId), paid.communityId)).toBeNull();
    const runs = await admin.db
      .select()
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.communityId, paid.communityId))
      .orderBy(asc(paymentExitRuns.createdAt));
    expect(runs.map((run) => [run.kind, run.choice, run.status])).toEqual([
      ["archive", "stop_at_period_end", "failed"],
      ["disconnect", "take_members", "done"],
    ]);
    const events = await noticesOf(paid);
    const members = events.flatMap((event) =>
      event.type === "paid_membership.changed" && event.payload.change === "billed_by_creator"
        ? event.payload.recipients.map((recipient) => recipient.userId)
        : [],
    );
    expect(members).toEqual([paid.buyerId]);
    const owner = events.filter((event) => event.type === "payments.fee_clear_required");
    expect(owner.map((event) => event.payload)).toEqual([
      expect.objectContaining({ ownerId: paid.ownerId, communityId: paid.communityId }),
    ]);
    expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
    expect(harness.gateway.subscriptions.get(subscription.id)?.applicationFeePercent).toBe(2);
    expect((await membershipOf(paid, paid.buyerId))?.status).toBe("active");
  });

  it("does nothing more when deauthorization arrives after a Cohory disconnect", async () => {
    const { harness, paid } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    const before = await noticesOf(paid);

    const result = await deliver(
      harness,
      "account.application.deauthorized",
      { id: "ca_test_app", object: "application" },
      { account: paid.accountId },
    );

    expect(result.status).toBe(200);
    expect(await noticesOf(paid)).toEqual(before);
    expect(before.some((event) => event.type === "payments.fee_clear_required")).toBe(false);
    const runs = await admin.db
      .select({ kind: paymentExitRuns.kind })
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.communityId, paid.communityId));
    expect(runs).toHaveLength(1);
  });

  it("ignores subscription events for a disconnected connection", async () => {
    const { harness, paid, subscription } = await disconnected();
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });

    const result = await deliver(
      harness,
      "customer.subscription.updated",
      { id: subscription.id, object: "subscription" },
      { account: paid.accountId },
    );

    expect(result).toEqual({ status: 200, outcome: "ignored" });
    expect((await subscriptionRow(subscription.id))?.providerStatus).toBe("active");
  });

  it("still answers unknown_connection for an account Cohory never connected", async () => {
    const harness = createHarness(probe.db);

    const result = await deliver(harness, "application_fee.created", {
      id: "fee_unknown",
      object: "application_fee",
      account: "acct_never_seen",
    });

    expect(result).toEqual({ status: 200, outcome: "unknown_connection" });
  });
});

describe("fee refunds settled in the platform currency", () => {
  it("records the refunded fee in the fee currency, not the settlement amount", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    harness.gateway.charges.set("ch_" + subscription.id, {
      id: "ch_" + subscription.id,
      amount: 29_000,
      amountRefunded: 29_000,
      currency: "usd",
      paymentIntentId: "pi_" + subscription.id,
      applicationFeeId: "fee_" + subscription.id,
    });
    harness.gateway.fees.set("fee_" + subscription.id, {
      id: "fee_" + subscription.id,
      accountId: paid.accountId,
      chargeId: "ch_" + subscription.id,
      amount: 290,
      amountRefunded: 290,
      currency: "usd",
      createdAt: new Date("2026-10-18T09:00:00Z"),
      refunds: [
        {
          id: "fr_" + subscription.id,
          amount: 218,
          currency: "gbp",
          createdAt: new Date("2026-10-18T09:30:00Z"),
          disputeId: null,
        },
      ],
    });

    const result = await deliver(
      harness,
      "charge.refunded",
      { id: "ch_" + subscription.id, object: "charge" },
      { account: paid.accountId },
    );

    expect(result).toEqual({ status: 200, outcome: "processed" });
    const refunded = (await ledgerOf(paid)).filter((entry) => entry.kind === "fee_refunded");
    expect(refunded).toHaveLength(1);
    expect(refunded[0]).toMatchObject({
      currency: "usd",
      providerFeeMinor: -290,
      computedFeeMinor: -290,
    });
    expect(harness.gateway.writes("refundApplicationFee")).toHaveLength(0);
  });
});
