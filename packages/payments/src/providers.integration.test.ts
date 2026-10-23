import { randomUUID } from "node:crypto";

import { ForbiddenError } from "@cohory/authz";
import { type CommunityId, type Database } from "@cohory/db";
import { feeLedgerEntries, paymentConnections, payments } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentsEnv } from "./config";
import { decryptSecret } from "./crypto";
import {
  AlreadyConnectedError,
  NotConnectedError,
  PaidSignupsPausedError,
  PaymentsValidationError,
  ProviderDisabledError,
} from "./errors";
import { signFakeEvent } from "./providers/fake/adapter";
import type { PaymentsRepository } from "./repository";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import {
  cloudEnv,
  communityEnv,
  encryptionKey,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import { createHarness, type Harness } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

const token = "polar_oat_fake_token_for_tests_only";
const run = randomUUID().slice(0, 8);
const ref = (name: string) => `${name}_${run}`;
const webhookSecret = "whsec_fake_provider_secret";

interface ByoCommunity {
  readonly harness: Harness;
  readonly communityId: CommunityId;
  readonly ownerId: string;
  readonly buyerId: string;
  readonly connectionId: string;
  readonly planId: string;
}

const suspended = new Set<string>();

async function setupByo(env: PaymentsEnv = cloudEnv()): Promise<ByoCommunity> {
  const harness = createHarness(probe.db, env, null, {
    isBillingSuspended: async (communityId) => suspended.has(communityId),
  });
  const communityId = await insertCommunity(admin.db);
  const ownerId = await insertMember(admin.db, communityId, "owner");
  const buyerId = await insertUser(admin.db);
  const owner = user(ownerId);
  const connected = await harness.service.connectProvider(owner, communityId, {
    provider: "polar",
    accessToken: token,
  });
  await harness.service.saveProviderWebhookSecret(owner, communityId, { webhookSecret });
  const plan = await harness.service.upsertPlan(owner, communityId, {
    currency: "USD",
    monthlyPriceMinor: 2900,
  });
  return { harness, communityId, ownerId, buyerId, connectionId: connected.id, planId: plan.id };
}

function deliver(byo: ByoCommunity, type: string, data: Record<string, unknown> & { id: string }) {
  const signed = signFakeEvent(webhookSecret, {
    id: `ev_${randomUUID()}`,
    type,
    data,
  });
  return {
    signed,
    send: () =>
      byo.harness.service.handleWebhook(
        { setup: "access_token", connectionId: byo.connectionId },
        {
          rawBody: signed.rawBody,
          headers: signed.headers,
        },
      ),
  };
}

function subscribe(byo: ByoCommunity, id: string): void {
  byo.harness.provider.subscriptions.set(id, {
    id,
    status: "active",
    customerId: `cust_${id}`,
    metadata: {
      cohory_community_id: byo.communityId,
      cohory_user_id: byo.buyerId,
      cohory_plan_id: byo.planId,
    },
    currentPeriodEnd: new Date("2026-11-19T10:00:00.000Z"),
    cancelAtPeriodEnd: false,
    endedAt: null,
    interval: "month",
    applicationFeePercent: null,
    priceId: `price_${byo.planId}_month`,
  });
}

function paid(id: string, subscriptionId: string | null, amountMinor: number, taxMinor = 0) {
  return {
    id,
    payment: {
      externalId: id,
      subscriptionId,
      paymentRef: id,
      currency: "usd",
      amountMinor,
      taxMinor,
      paidAt: "2026-10-19T10:00:00.000Z",
    },
  };
}

async function ledger(communityId: CommunityId) {
  return admin.db
    .select()
    .from(feeLedgerEntries)
    .where(eq(feeLedgerEntries.communityId, communityId))
    .orderBy(feeLedgerEntries.createdAt);
}

describe("connecting a bring your own provider", () => {
  it("stores the token encrypted and waits for the webhook secret before going live", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");

    const view = await harness.service.connectProvider(user(ownerId), communityId, {
      provider: "polar",
      accessToken: token,
    });

    expect(view).toMatchObject({
      provider: "polar",
      status: "onboarding",
      webhookSecretSaved: false,
      feeSplit: false,
      webhookPath: `/api/webhooks/payments/${view.id}`,
      livemode: false,
    });
    const [row] = await admin.db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.id, view.id));
    expect(row?.encryptedSecret).not.toContain(token);
    expect(decryptSecret(row?.encryptedSecret ?? "", encryptionKey, view.id)).toBe(token);

    const saved = await harness.service.saveProviderWebhookSecret(user(ownerId), communityId, {
      webhookSecret,
    });
    expect(saved).toMatchObject({ status: "active", webhookSecretSaved: true });
    const overview = await harness.service.getPaymentsOverview(user(ownerId), communityId);
    expect(overview.providers).toEqual(["stripe_connect", "polar"]);
  });

  it("offers the provider next to own keys on the Community Edition", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const overview = await harness.service.getPaymentsOverview(user(ownerId), communityId);
    expect(overview.providers).toEqual(["stripe_own_keys", "polar"]);
  });

  it("refuses the production server outside production", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await expect(
      harness.service.connectProvider(user(ownerId), communityId, {
        provider: "polar",
        accessToken: token,
        server: "production",
      }),
    ).rejects.toThrow(PaymentsValidationError);
  });

  it("lets only the owner connect", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const adminId = await insertMember(admin.db, communityId, "admin");
    await expect(
      harness.service.connectProvider(user(adminId), communityId, {
        provider: "polar",
        accessToken: token,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("does not replace a Stripe connection", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await harness.service.connectStripe(user(ownerId), communityId, { acceptCreatorTerms: true });
    await expect(
      harness.service.connectProvider(user(ownerId), communityId, {
        provider: "polar",
        accessToken: token,
      }),
    ).rejects.toThrow(AlreadyConnectedError);
    await expect(
      harness.service.saveProviderWebhookSecret(user(ownerId), communityId, { webhookSecret }),
    ).rejects.toThrow(NotConnectedError);
  });

  it("delivers a signed test event to the webhook URL and records it", async () => {
    const byo = await setupByo();
    const result = await byo.harness.service.sendTestWebhook(user(byo.ownerId), byo.communityId);
    expect(result).toMatchObject({ delivered: true, status: 200, outcome: "processed" });
    expect(result.connection.lastWebhookAt).toEqual(byo.harness.clock.now);
  });
});

describe("selling through a provider without a fee split", () => {
  it("provisions the plan and opens checkout through the provider", async () => {
    const byo = await setupByo();
    const checkout = await byo.harness.service.createCheckoutSession(
      user(byo.buyerId),
      byo.communityId,
    );
    expect(checkout.url).toMatch(/^https:\/\/checkout\.fake\.test\//);
    expect(byo.harness.provider.lastCheckout()).toMatchObject({
      priceId: `price_${byo.planId}_month`,
      platformFeeBps: 200,
      successUrl: expect.stringContaining("/membership?checkout=success"),
      metadata: { cohory_user_id: byo.buyerId, cohory_plan_id: byo.planId },
    });
  });

  it("pauses new paid signups while the platform invoice is past due and keeps members in", async () => {
    const byo = await setupByo();
    subscribe(byo, ref("sub_paused"));
    await deliver(
      byo,
      "payment.succeeded",
      paid(ref("order_paused"), ref("sub_paused"), 2900),
    ).send();
    const newcomer = await insertUser(admin.db);
    suspended.add(byo.communityId);

    await expect(
      byo.harness.service.createCheckoutSession(user(newcomer), byo.communityId),
    ).rejects.toThrow(PaidSignupsPausedError);
    expect(byo.harness.provider.lastCheckout()).toBeNull();
    const member = await byo.harness.service.getMyMembership(user(byo.buyerId), byo.communityId);
    expect(member.access).toMatchObject({ level: "member", source: "subscription" });

    suspended.delete(byo.communityId);
    const checkout = await byo.harness.service.createCheckoutSession(
      user(newcomer),
      byo.communityId,
    );
    expect(checkout.url).toMatch(/^https:\/\/checkout\.fake\.test\//);
  });

  it("accrues the platform fee on the pre tax amount once per payment", async () => {
    const byo = await setupByo();
    subscribe(byo, ref("sub_accrue"));
    const event = deliver(
      byo,
      "payment.succeeded",
      paid(ref("order_accrue"), ref("sub_accrue"), 3190, 290),
    );

    expect(await event.send()).toEqual({ status: 200, outcome: "processed" });
    expect(await event.send()).toEqual({ status: 200, outcome: "duplicate" });
    expect(
      await deliver(
        byo,
        "payment.succeeded",
        paid(ref("order_accrue"), ref("sub_accrue"), 3190, 290),
      ).send(),
    ).toEqual({ status: 200, outcome: "processed" });

    const entries = await ledger(byo.communityId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "fee_accrued",
      provider: "polar",
      collectionMethod: "periodic_invoice",
      currency: "usd",
      baseMinor: 2900,
      rateBps: 200,
      computedFeeMinor: 58,
      providerFeeMinor: null,
      externalRef: ref("order_accrue"),
      idempotencyKey: `fee:accrued:polar:${ref("order_accrue")}`,
    });
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.communityId, byo.communityId));
    expect(entries[0]?.paymentId).toBe(payment?.id);
    const mine = await byo.harness.service.getMyMembership(user(byo.buyerId), byo.communityId);
    expect(mine.access).toMatchObject({ level: "member", source: "subscription" });
    expect(mine.provider).toEqual({ id: "polar", name: "Polar", customerPortal: true });
    expect(mine.canManageBilling).toBe(true);
  });

  it("reverses the accrued fee in proportion to refunds", async () => {
    const byo = await setupByo();
    subscribe(byo, ref("sub_refund"));
    await deliver(
      byo,
      "payment.succeeded",
      paid(ref("order_refund"), ref("sub_refund"), 10_000),
    ).send();
    const refund = (refundedMinor: number) =>
      deliver(byo, "payment.refunded", {
        id: `refund_${run}_${refundedMinor}`,
        refund: {
          chargeRef: ref("order_refund"),
          paymentRef: ref("order_refund"),
          chargedMinor: 10_000,
          refundedMinor,
          paymentRefundedMinor: refundedMinor,
        },
      }).send();

    await refund(2_500);
    await refund(2_500);
    await refund(10_000);

    const entries = await ledger(byo.communityId);
    expect(entries.map((entry) => [entry.kind, entry.computedFeeMinor])).toEqual([
      ["fee_accrued", 200],
      ["fee_refunded", -50],
      ["fee_refunded", -150],
    ]);
    expect(entries.every((entry) => entry.collectionMethod === "periodic_invoice")).toBe(true);
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(and(eq(payments.communityId, byo.communityId)));
    expect(payment?.refundedMinor).toBe(10_000);
  });

  it("records neither a payment nor a fee for sales that are not cohory memberships", async () => {
    const byo = await setupByo();
    await deliver(byo, "payment.succeeded", {
      ...paid(ref("order_other"), null, 5000),
    }).send();
    byo.harness.provider.subscriptions.set(ref("sub_other"), {
      id: ref("sub_other"),
      status: "active",
      customerId: `cust_${ref("sub_other")}`,
      metadata: {},
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      interval: "month",
      applicationFeePercent: null,
      priceId: "someone_elses_product",
    });
    await deliver(
      byo,
      "payment.succeeded",
      paid(ref("order_other_sub"), ref("sub_other"), 5000),
    ).send();
    expect(await ledger(byo.communityId)).toEqual([]);
    expect(
      await admin.db.select().from(payments).where(eq(payments.communityId, byo.communityId)),
    ).toEqual([]);
  });

  it("accrues nothing on the Community Edition", async () => {
    const byo = await setupByo(communityEnv());
    subscribe(byo, ref("sub_ce"));
    await deliver(byo, "payment.succeeded", paid(ref("order_ce"), ref("sub_ce"), 2900)).send();
    expect(await ledger(byo.communityId)).toEqual([]);
  });
});

describe("the provider webhook endpoint", () => {
  it("refuses a wrong signature, an unknown id, and Stripe connections", async () => {
    const byo = await setupByo();
    const forged = signFakeEvent("whsec_wrong_secret_value", {
      id: "ev_forged",
      type: "ping",
      data: { id: "x" },
    });
    expect(
      await byo.harness.service.handleWebhook(
        { setup: "access_token", connectionId: byo.connectionId },
        forged,
      ),
    ).toEqual({
      status: 400,
      outcome: "invalid_signature",
    });
    expect(
      await byo.harness.service.handleWebhook(
        { setup: "access_token", connectionId: "not-a-uuid" },
        forged,
      ),
    ).toEqual({
      status: 404,
      outcome: "unknown_connection",
    });

    const stripe = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const { connection } = await stripe.service.connectStripe(user(ownerId), communityId, {
      acceptCreatorTerms: true,
    });
    expect(
      await stripe.service.handleWebhook(
        { setup: "access_token", connectionId: connection.id },
        forged,
      ),
    ).toEqual({
      status: 404,
      outcome: "unknown_connection",
    });
  });

  it("answers not configured until the webhook secret is saved", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const view = await harness.service.connectProvider(user(ownerId), communityId, {
      provider: "polar",
      accessToken: token,
    });
    const signed = signFakeEvent(webhookSecret, {
      id: "ev_early",
      type: "ping",
      data: { id: "x" },
    });
    expect(
      await harness.service.handleWebhook({ setup: "access_token", connectionId: view.id }, signed),
    ).toEqual({
      status: 503,
      outcome: "not_configured",
    });
  });

  it("stops accepting events after disconnect", async () => {
    const byo = await setupByo();
    await byo.harness.service.disconnectStripe(user(byo.ownerId), byo.communityId);
    const event = deliver(byo, "ping", { id: "after" });
    expect(await event.send()).toEqual({ status: 404, outcome: "unknown_connection" });
  });
});

async function ownKeysConnection(
  options: { wrapRepo?: (repo: PaymentsRepository) => PaymentsRepository } = {},
) {
  const harness = createHarness(probe.db, communityEnv(), null, options);
  const communityId = await insertCommunity(admin.db);
  const ownerId = await insertMember(admin.db, communityId, "owner");
  const connection = await harness.service.connectOwnKeys(user(ownerId), communityId, {
    secretKey: "sk_test_routeowner",
    webhookSecret: "whsec_routeowner",
  });
  return { harness, connection };
}

describe("webhook routes and connection setups", () => {
  const unknown = { status: 404, outcome: "unknown_connection" };

  it("refuses an own keys connection on the provider route", async () => {
    const { harness, connection } = await ownKeysConnection();
    const signed = signFakeEvent(webhookSecret, {
      id: ref("ev_own"),
      type: "ping",
      data: { id: "x" },
    });
    expect(
      await harness.service.handleWebhook(
        { setup: "access_token", connectionId: connection.id },
        signed,
      ),
    ).toEqual(unknown);
  });

  it("refuses a Polar connection on the own keys route", async () => {
    const byo = await setupByo(communityEnv());
    const event = signedEvent(
      "customer.subscription.updated",
      { id: "sub_x" },
      {
        secret: webhookSecret,
      },
    );
    expect(
      await byo.harness.service.handleWebhook(
        { setup: "own_keys", connectionId: byo.connectionId },
        stripeDelivery(event),
      ),
    ).toEqual(unknown);
  });

  it("does not route a platform event to an own keys account", async () => {
    const { connection } = await ownKeysConnection();
    const platform = createHarness(probe.db, cloudEnv());
    const event = signedEvent(
      "customer.subscription.updated",
      { id: "sub_x" },
      {
        account: connection.externalAccountId,
        secret: "whsec_platform",
      },
    );
    expect(
      await platform.service.handleWebhook({ setup: "platform_account" }, stripeDelivery(event)),
    ).toEqual({ status: 200, outcome: "unknown_connection" });
  });

  it("answers not configured while the own keys API secret is missing", async () => {
    const { harness, connection } = await ownKeysConnection({
      wrapRepo: (repo) => ({
        ...repo,
        async findConnectionById(id) {
          const found = await repo.findConnectionById(id);
          return found ? { ...found, encryptedSecret: null } : null;
        },
      }),
    });
    const event = signedEvent(
      "customer.subscription.updated",
      { id: "sub_x" },
      {
        secret: "whsec_routeowner",
      },
    );
    expect(
      await harness.service.handleWebhook(
        { setup: "own_keys", connectionId: connection.id },
        stripeDelivery(event),
      ),
    ).toEqual({ status: 503, outcome: "not_configured" });
  });
});

describe("Polar while COHORY_ENABLE_POLAR is off", () => {
  const polarOff = () => cloudEnv({ polarEnabled: false });

  it("leaves Polar out of the provider list when the flag is off", async () => {
    for (const env of [polarOff(), communityEnv({ polarEnabled: false })]) {
      const harness = createHarness(probe.db, env);
      const communityId = await insertCommunity(admin.db);
      const ownerId = await insertMember(admin.db, communityId, "owner");
      const overview = await harness.service.getPaymentsOverview(user(ownerId), communityId);
      expect(overview.providers).not.toContain("polar");
      expect(overview.polarRetired).toBe(false);
    }
  });

  it("refuses a new Polar connection when the flag is off", async () => {
    const harness = createHarness(probe.db, polarOff());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");

    await expect(
      harness.service.connectProvider(user(ownerId), communityId, {
        provider: "polar",
        accessToken: token,
      }),
    ).rejects.toThrow(ProviderDisabledError);

    const rows = await admin.db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.communityId, communityId));
    expect(rows).toEqual([]);
  });

  it("refuses a checkout on an existing Polar connection when the flag is off", async () => {
    const byo = await setupByo();
    const off = createHarness(probe.db, polarOff());

    await expect(
      off.service.createCheckoutSession(user(byo.buyerId), byo.communityId),
    ).rejects.toThrow(ProviderDisabledError);
    expect(off.provider.lastCheckout()).toBeNull();
    const membership = await off.service.getMyMembership(user(byo.buyerId), byo.communityId);
    expect(membership.plan?.purchasable).toBe(false);
  });

  it("keeps processing webhooks for an existing Polar connection when the flag is off", async () => {
    const byo = await setupByo();
    const off: ByoCommunity = { ...byo, harness: createHarness(probe.db, polarOff()) };

    expect(await deliver(off, "ping", { id: ref("ping_off") }).send()).toEqual({
      status: 200,
      outcome: "processed",
    });
  });

  it("marks the overview polarRetired for an existing Polar connection", async () => {
    const byo = await setupByo();
    const off = createHarness(probe.db, polarOff());

    const overview = await off.service.getPaymentsOverview(user(byo.ownerId), byo.communityId);
    expect(overview.polarRetired).toBe(true);
    expect(overview.connection?.provider).toBe("polar");
    const on = await byo.harness.service.getPaymentsOverview(user(byo.ownerId), byo.communityId);
    expect(on.polarRetired).toBe(false);
  });
});
