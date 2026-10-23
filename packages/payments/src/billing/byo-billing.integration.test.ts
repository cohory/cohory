import { randomUUID } from "node:crypto";

import { type CommunityId, type Database } from "@cohory/db";
import { feeLedgerEntries, platformBillingAccounts, platformInvoices } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentsEnv } from "../config";
import { PaidSignupsPausedError } from "../errors";
import { createPolarProvider } from "../providers/polar/adapter";
import { signStandardWebhook } from "../providers/polar/webhook";
import { createPostgresPaymentsRepository } from "../postgres-repository";
import { createPaymentsService, type PaymentsService } from "../service";
import { verifyStripeWebhook } from "../stripe-gateway";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "../test/fixtures";
import { createHarness, setupPaidCommunity } from "../test/harness";
import { createPostgresBillingRepository } from "./postgres-store";
import { createPlatformBillingService, type PlatformBillingService } from "./service";
import { createFakeBillingGateway } from "./testing/fake-billing-gateway";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

type Json = Record<string, unknown>;

const webhookSecret = `whsec_${Buffer.from("byo billing integration key").toString("base64")}`;
const clock = { now: new Date("2026-10-19T10:10:00.000Z") };

function billingFor(env: PaymentsEnv): PlatformBillingService {
  return createPlatformBillingService({
    repo: createPostgresBillingRepository(admin.db),
    paymentsRepo: createPostgresPaymentsRepository(admin.db),
    env,
    gateway: env.stripeSecretKey ? createFakeBillingGateway() : null,
    verifyWebhook: verifyStripeWebhook,
    now: () => clock.now,
    log: () => undefined,
  });
}

function fakePolarApi(organizationId: string) {
  const products = new Map<string, Json>();
  const subscriptions = new Map<string, Json>();
  const orders = new Map<string, Json>();
  let checkouts = 0;
  const fetchStub: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : {};
    const [, , collection, id] = url.pathname.split("/");
    if (method === "GET" && collection === "organizations") {
      return Response.json({
        items: [
          {
            id: organizationId,
            name: "Studio",
            status: "active",
            details_submitted_at: "2026-10-01T09:30:00Z",
            capabilities: { checkout_payments: true },
          },
        ],
      });
    }
    if (method === "GET" && collection === "products" && !id) {
      return Response.json({ items: [] });
    }
    if (method === "POST" && collection === "products") {
      const product = {
        id: randomUUID(),
        is_archived: false,
        recurring_interval: body["recurring_interval"],
        metadata: body["metadata"],
      };
      products.set(product.id, product);
      return Response.json(product, { status: 201 });
    }
    if (method === "POST" && collection === "checkouts") {
      checkouts += 1;
      return Response.json({ id: `chk_${checkouts}`, url: `https://polar.test/c/${checkouts}` });
    }
    const found =
      collection === "subscriptions" ? subscriptions.get(id ?? "") : orders.get(id ?? "");
    if (method === "GET" && found) {
      return Response.json(found);
    }
    return Response.json({ error: "ResourceNotFound" }, { status: 404 });
  };
  return { fetchStub, products, subscriptions, orders, checkoutCount: () => checkouts };
}

interface PolarCommunity {
  readonly service: PaymentsService;
  readonly api: ReturnType<typeof fakePolarApi>;
  readonly communityId: CommunityId;
  readonly buyerId: string;
  readonly connectionId: string;
  readonly planId: string;
  readonly productId: string;
}

async function setupPolar(billing: PlatformBillingService): Promise<PolarCommunity> {
  const api = fakePolarApi(randomUUID());
  const env = cloudEnv();
  const service = createPaymentsService({
    repo: createPostgresPaymentsRepository(probe.db),
    env,
    verifyWebhook: verifyStripeWebhook,
    providers: [
      createPolarProvider({ apiBaseUrl: null, fetch: api.fetchStub, now: () => clock.now }),
    ],
    isBillingSuspended: billing.isBillingSuspended,
    now: () => clock.now,
    log: () => undefined,
  });
  const communityId = await insertCommunity(admin.db);
  const owner = user(await insertMember(admin.db, communityId, "owner"));
  const buyerId = await insertUser(admin.db);
  const connected = await service.connectProvider(owner, communityId, {
    provider: "polar",
    accessToken: "polar_oat_integration_token",
  });
  await service.saveProviderWebhookSecret(owner, communityId, { webhookSecret });
  const plan = await service.upsertPlan(owner, communityId, {
    currency: "USD",
    monthlyPriceMinor: 100_050,
  });
  const productId = [...api.products.keys()][0] ?? "";
  return {
    service,
    api,
    communityId,
    buyerId,
    connectionId: connected.id,
    planId: plan.id,
    productId,
  };
}

function deliver(polar: PolarCommunity, type: string, data: Json & { id: string }) {
  const rawBody = JSON.stringify({ type, timestamp: clock.now.toISOString(), data });
  const headers = signStandardWebhook(webhookSecret, `msg_${randomUUID()}`, clock.now, rawBody);
  return polar.service.handleWebhook(
    { setup: "access_token", connectionId: polar.connectionId },
    { rawBody, headers },
  );
}

function order(polar: PolarCommunity, id: string, subscriptionId: string, refunded = 0): Json {
  return {
    id,
    status: refunded > 0 ? "partially_refunded" : "paid",
    paid: true,
    net_amount: 100_050,
    tax_amount: 10_005,
    total_amount: 110_055,
    refunded_amount: refunded,
    refunded_tax_amount: Math.round(refunded / 10),
    currency: "usd",
    subscription_id: subscriptionId,
    product_id: polar.productId,
    created_at: "2026-10-19T10:06:05Z",
  };
}

function subscription(polar: PolarCommunity, id: string): Json {
  return {
    id,
    status: "active",
    customer_id: randomUUID(),
    product_id: polar.productId,
    current_period_end: "2026-11-19T10:06:00Z",
    cancel_at_period_end: false,
    recurring_interval: "month",
    recurring_interval_count: 1,
    metadata: {
      cohory_community_id: polar.communityId,
      cohory_user_id: polar.buyerId,
      cohory_plan_id: polar.planId,
    },
  };
}

async function suspend(communityId: CommunityId): Promise<void> {
  await admin.db
    .insert(platformBillingAccounts)
    .values({ communityId, suspendedAt: new Date("2026-12-05T00:00:00.000Z") })
    .onConflictDoUpdate({
      target: platformBillingAccounts.communityId,
      set: { suspendedAt: new Date("2026-12-05T00:00:00.000Z") },
    });
}

describe("Polar sales on the monthly platform invoice", () => {
  it("bills a Polar order accrual net of its partial refund through the invoice run", async () => {
    clock.now = new Date("2026-10-19T10:10:00.000Z");
    const billing = billingFor(cloudEnv());
    const polar = await setupPolar(billing);
    const subscriptionId = randomUUID();
    const orderId = randomUUID();
    polar.api.subscriptions.set(subscriptionId, subscription(polar, subscriptionId));
    polar.api.orders.set(orderId, order(polar, orderId, subscriptionId));

    expect(await deliver(polar, "order.paid", { id: orderId })).toEqual({
      status: 200,
      outcome: "processed",
    });
    clock.now = new Date("2026-10-25T09:00:00.000Z");
    polar.api.orders.set(orderId, order(polar, orderId, subscriptionId, 25_000));
    expect(await deliver(polar, "order.refunded", { id: orderId })).toEqual({
      status: 200,
      outcome: "processed",
    });

    const entries = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.communityId, polar.communityId))
      .orderBy(feeLedgerEntries.occurredAt);
    expect(
      entries.map((entry) => [entry.kind, entry.collectionMethod, entry.computedFeeMinor]),
    ).toEqual([
      ["fee_accrued", "periodic_invoice", 2001],
      ["fee_refunded", "periodic_invoice", -500],
    ]);
    expect(entries[0]).toMatchObject({ provider: "polar", baseMinor: 100_050, rateBps: 200 });

    clock.now = new Date("2026-11-01T00:10:00.000Z");
    const run = await billing.generateInvoices({ communityIds: [polar.communityId] });

    expect(run).toMatchObject({ period: "2026-10", created: 1, failed: 0 });
    const invoices = await admin.db
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.communityId, polar.communityId));
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ currency: "usd", amountMinor: 1501 });
  });
});

describe("paid signups while the platform invoice is past due", () => {
  it("refuses new Polar checkout once billing is suspended and keeps the existing member in", async () => {
    clock.now = new Date("2026-12-05T10:00:00.000Z");
    const billing = billingFor(cloudEnv());
    const polar = await setupPolar(billing);
    const subscriptionId = randomUUID();
    const orderId = randomUUID();
    polar.api.subscriptions.set(subscriptionId, subscription(polar, subscriptionId));
    polar.api.orders.set(orderId, {
      ...order(polar, orderId, subscriptionId),
      created_at: "2026-12-05T09:59:00Z",
    });
    await deliver(polar, "order.paid", { id: orderId });
    await suspend(polar.communityId);
    const newcomer = await insertUser(admin.db);

    const refused = polar.service.createCheckoutSession(user(newcomer), polar.communityId);

    await expect(refused).rejects.toBeInstanceOf(PaidSignupsPausedError);
    await expect(refused).rejects.toMatchObject({ code: "paid_signups_paused" });
    expect(polar.api.checkoutCount()).toBe(0);
    const member = await polar.service.getMyMembership(user(polar.buyerId), polar.communityId);
    expect(member.access).toMatchObject({ level: "member", source: "subscription" });
  });

  it("keeps Stripe Connect checkout open because its fee is collected at charge time", async () => {
    const billing = billingFor(cloudEnv());
    const harness = createHarness(probe.db, cloudEnv(), null, {
      isBillingSuspended: billing.isBillingSuspended,
    });
    const paid = await setupPaidCommunity(admin.db, harness);
    await suspend(paid.communityId);

    const checkout = await harness.service.createCheckoutSession(
      user(paid.buyerId),
      paid.communityId,
    );

    expect(checkout.url).toBeTruthy();
    expect(await billing.isBillingSuspended(paid.communityId)).toBe(true);
  });

  it("never suspends on the Community Edition", async () => {
    const billing = billingFor(communityEnv());
    const communityId = await insertCommunity(admin.db);
    await suspend(communityId);

    expect(await billing.isBillingSuspended(communityId)).toBe(false);
  });
});
