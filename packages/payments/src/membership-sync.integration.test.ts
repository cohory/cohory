import { getMembership, withCommunity, type Database } from "@cohory/db";
import { subscriptions } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GatewaySubscription } from "./gateway";
import type { PaymentsRepository, PaymentsStore } from "./repository";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { openProbeDb, openTestDb } from "./test/fixtures";
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

class MembershipWriteFailed extends Error {}

function failingMembershipWrites(failures: { remaining: number }) {
  const fail = () => {
    if (failures.remaining > 0) {
      failures.remaining -= 1;
      throw new MembershipWriteFailed("membership write failed");
    }
  };
  return (repo: PaymentsRepository): PaymentsRepository => ({
    ...repo,
    async removeMembership(communityId, userId) {
      fail();
      await repo.removeMembership(communityId, userId);
    },
    inCommunityAsSystem(communityId, fn) {
      return repo.inCommunityAsSystem(communityId, (store) => {
        const wrapped: PaymentsStore = {
          ...store,
          async removeMember(userId) {
            fail();
            await store.removeMember(userId);
          },
        };
        return fn(wrapped);
      });
    },
  });
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
  harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
  expect(await deliver(harness, paid, "customer.subscription.created", subscription.id)).toEqual({
    status: 200,
    outcome: "processed",
  });
  return subscription;
}

async function accessStateOf(externalId: string): Promise<string | null> {
  const [row] = await admin.db
    .select({ accessState: subscriptions.accessState })
    .from(subscriptions)
    .where(eq(subscriptions.externalSubscriptionId, externalId));
  return row?.accessState ?? null;
}

async function statusOf(paid: PaidCommunity, userId: string): Promise<string | null> {
  return (await getMembership(withCommunity(admin.db, paid.communityId), userId))?.status ?? null;
}

describe("membership changes from subscription events", () => {
  it("keeps the subscription and the membership in step when the membership write fails", async () => {
    const failures = { remaining: 0 };
    const harness = createHarness(probe.db, undefined, null, {
      wrapRepo: failingMembershipWrites(failures),
    });
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    expect(await statusOf(paid, paid.buyerId)).toBe("active");

    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });
    harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
    failures.remaining = 1;
    const cancel = signedEvent(
      "customer.subscription.deleted",
      { id: subscription.id, object: "subscription" },
      { account: paid.accountId },
    );
    const request = { rawBody: cancel.rawBody, signature: cancel.signature };
    const first = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(first).toEqual({ status: 500, outcome: "failed" });
    expect(await accessStateOf(subscription.id)).toBe("granted");
    expect(await statusOf(paid, paid.buyerId)).toBe("active");

    harness.clock.now = new Date(harness.clock.now.getTime() + 60_000);
    const retried = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery(request),
    );

    expect(retried).toEqual({ status: 200, outcome: "processed" });
    expect(await accessStateOf(subscription.id)).toBe("revoked");
    expect(await statusOf(paid, paid.buyerId)).toBe("removed");
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(false);
  });

  it("removes a member left active by an earlier revocation when the next event arrives", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await subscribe(harness, paid, paid.buyerId);
    await admin.db
      .update(subscriptions)
      .set({ accessState: "revoked", providerStatus: "canceled" })
      .where(eq(subscriptions.externalSubscriptionId, subscription.id));
    expect(await statusOf(paid, paid.buyerId)).toBe("active");

    harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });
    harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
    expect(await deliver(harness, paid, "customer.subscription.updated", subscription.id)).toEqual({
      status: 200,
      outcome: "processed",
    });

    expect(await statusOf(paid, paid.buyerId)).toBe("removed");
  });

  it("keeps a member whose other subscription still grants access", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const older = await subscribe(harness, paid, paid.buyerId);
    await mirrorSubscription(admin.db, paid.communityId, {
      userId: paid.buyerId,
      planId: paid.planId,
      accessState: "granted",
    });

    harness.gateway.subscriptions.set(older.id, { ...older, status: "canceled" });
    harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
    await deliver(harness, paid, "customer.subscription.deleted", older.id);

    expect(await accessStateOf(older.id)).toBe("revoked");
    expect(await statusOf(paid, paid.buyerId)).toBe("active");
  });
});
