import type { Database } from "@cohory/db";
import { paymentConnections, paymentCustomers, subscriptions } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StripeRejectedError } from "./errors";
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

async function billedSubscriber(harness: Harness, paid: PaidCommunity, status = "active") {
  const [connection] = await admin.db
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, paid.communityId));
  if (!connection) throw new Error("no connection");
  const gatewaySubscription = stripeSubscription(paid, paid.buyerId, { status });
  harness.gateway.subscriptions.set(gatewaySubscription.id, gatewaySubscription);
  const [customer] = await admin.db
    .insert(paymentCustomers)
    .values({
      communityId: paid.communityId,
      userId: paid.buyerId,
      connectionId: connection.id,
      externalCustomerId: gatewaySubscription.customerId,
    })
    .returning();
  if (!customer) throw new Error("no customer");
  await admin.db.insert(subscriptions).values({
    communityId: paid.communityId,
    userId: paid.buyerId,
    customerId: customer.id,
    connectionId: connection.id,
    planId: paid.planId,
    externalSubscriptionId: gatewaySubscription.id,
    providerStatus: status,
    accessState: status === "active" ? "granted" : "revoked",
    applicationFeeBps: 200,
    providerFetchedAt: harness.clock.now,
  });
  return { connectionId: connection.id, gatewaySubscription, customer };
}

describe("releasing billing for an erased account", () => {
  it("cancels open subscriptions and deletes the Stripe customer with idempotency keys", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const { gatewaySubscription, customer } = await billedSubscriber(harness, paid);

    const result = await harness.service.releaseBillingForUser(paid.communityId, paid.buyerId);

    expect(result).toEqual({ canceled: 1, customersDeleted: 1, skipped: 0 });
    expect(harness.gateway.subscriptions.get(gatewaySubscription.id)?.status).toBe("canceled");
    expect(harness.gateway.deletedCustomers.has(customer.externalCustomerId)).toBe(true);
    const cancels = harness.gateway.writes("cancelSubscription");
    expect(cancels[0]).toMatchObject({ account: paid.accountId });
    expect(cancels[0]?.idempotencyKey).toMatch(/^erase:.+:cancel$/);
    expect(harness.gateway.writes("deleteCustomer")[0]?.idempotencyKey).toBe(
      `erase:${customer.id}:delete`,
    );
  });

  it("skips ended subscriptions and does nothing for a person without billing", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await billedSubscriber(harness, paid, "canceled");

    expect(await harness.service.releaseBillingForUser(paid.communityId, paid.buyerId)).toEqual({
      canceled: 0,
      customersDeleted: 1,
      skipped: 0,
    });
    expect(await harness.service.releaseBillingForUser(paid.communityId, paid.memberId)).toEqual({
      canceled: 0,
      customersDeleted: 0,
      skipped: 0,
    });
  });

  it("skips a disconnected account and lets a Stripe failure reach the caller", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const { connectionId } = await billedSubscriber(harness, paid);
    const failing = createHarness(probe.db);
    failing.gateway.cancelSubscription = async () => {
      throw Object.assign(new Error("boom"), { type: "StripeAPIError", code: "api_error" });
    };
    failing.gateway.subscriptions.set(
      [...harness.gateway.subscriptions.keys()][0] ?? "",
      [...harness.gateway.subscriptions.values()][0] ?? stripeSubscription(paid, paid.buyerId),
    );
    await expect(
      failing.service.releaseBillingForUser(paid.communityId, paid.buyerId),
    ).rejects.toBeInstanceOf(StripeRejectedError);

    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: new Date() })
      .where(eq(paymentConnections.id, connectionId));
    expect(await harness.service.releaseBillingForUser(paid.communityId, paid.buyerId)).toEqual({
      canceled: 0,
      customersDeleted: 0,
      skipped: 2,
    });
  });
});
