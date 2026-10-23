import { newId, type Database } from "@cohory/db";
import { paymentConnections, paymentCustomers, payments, subscriptions } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openProbeDb, openTestDb } from "./test/fixtures";
import { createHarness, setupPaidCommunity, type PaidCommunity } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function subscribe(
  paid: PaidCommunity,
  options: { status: string; createdAt: Date; origin?: string; paidAt?: Date },
): Promise<string> {
  const [connection] = await admin.db
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, paid.communityId));
  if (!connection) throw new Error("no connection");
  const [customer] = await admin.db
    .insert(paymentCustomers)
    .values({
      communityId: paid.communityId,
      userId: paid.buyerId,
      connectionId: connection.id,
      externalCustomerId: `cus_${newId()}`,
    })
    .returning();
  if (!customer) throw new Error("no customer");
  const [subscription] = await admin.db
    .insert(subscriptions)
    .values({
      communityId: paid.communityId,
      userId: paid.buyerId,
      customerId: customer.id,
      connectionId: connection.id,
      planId: paid.planId,
      externalSubscriptionId: `sub_${newId()}`,
      providerStatus: options.status,
      accessState: options.status === "active" ? "granted" : "revoked",
      interval: "month",
      applicationFeeBps: 200,
      origin: options.origin ?? "created_by_cohory",
      providerFetchedAt: options.createdAt,
      createdAt: options.createdAt,
    })
    .returning();
  if (!subscription) throw new Error("no subscription");
  if (options.paidAt) {
    await admin.db.insert(payments).values({
      communityId: paid.communityId,
      subscriptionId: subscription.id,
      externalInvoiceId: `in_${newId()}`,
      currency: "usd",
      amountMinor: 1000,
      occurredAt: options.paidAt,
    });
  }
  return subscription.id;
}

describe("subscriber tenure", () => {
  it("dates paying from the first paid invoice, which skips a trial", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const createdAt = new Date("2026-08-01T00:00:00Z");
    const paidAt = new Date("2026-08-15T00:00:00Z");
    await subscribe(paid, { status: "active", createdAt, paidAt });

    const tenure = await harness.service.listSubscriberTenure(paid.communityId, [paid.buyerId]);

    expect(tenure.get(paid.buyerId)).toMatchObject({
      providerStatus: "active",
      accessState: "granted",
      interval: "month",
      origin: "created_by_cohory",
      paidSince: paidAt,
    });
  });

  it("falls back to the subscription start for a linked subscription without invoices", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const createdAt = new Date("2026-07-01T00:00:00Z");
    await subscribe(paid, { status: "active", createdAt, origin: "linked_import" });

    const tenure = await harness.service.listSubscriberTenure(paid.communityId, [paid.buyerId]);

    expect(tenure.get(paid.buyerId)).toMatchObject({
      origin: "linked_import",
      paidSince: createdAt,
    });
  });

  it("keeps dating a linked subscription from the link after its first invoice", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const createdAt = new Date("2026-07-01T00:00:00Z");
    const paidAt = new Date("2026-07-20T00:00:00Z");
    await subscribe(paid, { status: "active", createdAt, origin: "linked_import", paidAt });

    const tenure = await harness.service.listSubscriberTenure(paid.communityId, [paid.buyerId]);

    expect(tenure.get(paid.buyerId)).toMatchObject({
      origin: "linked_import",
      paidSince: createdAt,
    });
  });

  it("prefers the subscription that grants access over an ended one", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await subscribe(paid, { status: "canceled", createdAt: new Date("2026-01-01T00:00:00Z") });
    await subscribe(paid, { status: "active", createdAt: new Date("2026-09-01T00:00:00Z") });

    const tenure = await harness.service.listSubscriberTenure(paid.communityId, [paid.buyerId]);

    expect(tenure.get(paid.buyerId)?.providerStatus).toBe("active");
  });

  it("returns nothing for people without a subscription and nothing across tenants", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const other = await setupPaidCommunity(admin.db, harness);
    await subscribe(paid, { status: "active", createdAt: new Date("2026-08-01T00:00:00Z") });

    expect(
      (await harness.service.listSubscriberTenure(other.communityId, [paid.buyerId])).size,
    ).toBe(0);
    expect((await harness.service.listSubscriberTenure(paid.communityId, [])).size).toBe(0);
  });
});
