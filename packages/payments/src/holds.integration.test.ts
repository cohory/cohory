import { getMembership, newId, withCommunity, type Database } from "@cohory/db";
import { communities, inviteLinks, membershipHolds } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
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

const hour = 60 * 60 * 1000;

async function invited(paid: PaidCommunity, expiresAt: Date, maxUses: number | null = null) {
  await admin.db
    .update(communities)
    .set({ joinMode: "invite" })
    .where(eq(communities.id, paid.communityId));
  const [invite] = await admin.db
    .insert(inviteLinks)
    .values({
      communityId: paid.communityId,
      token: `hold-${newId()}`,
      createdBy: paid.ownerId,
      useCount: 1,
      maxUses,
    })
    .returning({ id: inviteLinks.id });
  if (!invite) throw new Error("invite insert returned no row");
  const userId = await insertMember(admin.db, paid.communityId, "member", "pending");
  await admin.db
    .insert(membershipHolds)
    .values({ communityId: paid.communityId, userId, inviteId: invite.id, expiresAt });
  return { userId, inviteId: invite.id };
}

async function holdOf(paid: PaidCommunity, userId: string) {
  const [row] = await admin.db
    .select()
    .from(membershipHolds)
    .where(
      and(eq(membershipHolds.communityId, paid.communityId), eq(membershipHolds.userId, userId)),
    );
  return row ?? null;
}

async function useCount(inviteId: string) {
  const [row] = await admin.db
    .select({ useCount: inviteLinks.useCount })
    .from(inviteLinks)
    .where(eq(inviteLinks.id, inviteId));
  return row?.useCount;
}

async function removalReasonOf(paid: PaidCommunity, userId: string) {
  return (await getMembership(withCommunity(admin.db, paid.communityId), userId))?.removalReason;
}

async function completeCheckout(harness: Harness, paid: PaidCommunity, userId: string) {
  const subscription = stripeSubscription(paid, userId);
  harness.gateway.subscriptions.set(subscription.id, subscription);
  await webhook(harness, paid, "checkout.session.completed", {
    id: `cs_${subscription.id}`,
    object: "checkout.session",
    mode: "subscription",
    subscription: subscription.id,
    customer: subscription.customerId,
    metadata: subscription.metadata,
  });
}

async function statusOf(paid: PaidCommunity, userId: string) {
  return (await getMembership(withCommunity(admin.db, paid.communityId), userId))?.status;
}

async function webhook(
  harness: Harness,
  paid: PaidCommunity,
  type: string,
  object: Record<string, unknown> & { id: string },
) {
  const event = signedEvent(type, object, { account: paid.accountId });
  const result = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
  expect(result.status).toBe(200);
}

describe("invite holds", () => {
  it("pushes the hold out to the Checkout Session expiry", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId } = await invited(paid, new Date(harness.clock.now.getTime() + hour));

    await harness.service.createCheckoutSession(user(userId), paid.communityId);

    const expiresAt = harness.gateway.lastCheckout()?.expiresAt;
    expect(expiresAt?.getTime()).toBe(harness.clock.now.getTime() + 24 * hour - 5 * 60 * 1000);
    expect((await holdOf(paid, userId))?.expiresAt).toEqual(expiresAt);
  });

  it("releases an expired hold once: removes the pending membership and gives the use back", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() - 1));

    const first = await harness.service.expireMembershipHolds();
    const second = await harness.service.expireMembershipHolds();

    expect(first.released).toBeGreaterThanOrEqual(1);
    expect(second.released).toBe(0);
    expect(await statusOf(paid, userId)).toBe("removed");
    expect(await removalReasonOf(paid, userId)).toBe("hold_expired");
    expect(await useCount(inviteId)).toBe(0);
    expect((await holdOf(paid, userId))?.releasedAt).toEqual(harness.clock.now);
  });

  it("lets the payer in when Checkout completes after the hold was released and takes the use again", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() - 1));
    await harness.service.expireMembershipHolds();

    await completeCheckout(harness, paid, userId);

    expect(await statusOf(paid, userId)).toBe("active");
    expect(await useCount(inviteId)).toBe(1);
    expect(await holdOf(paid, userId)).toBeNull();
  });

  it("still lets the payer in when the invite was used up meanwhile, and logs it", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() - 1), 1);
    await harness.service.expireMembershipHolds();
    await admin.db.update(inviteLinks).set({ useCount: 1 }).where(eq(inviteLinks.id, inviteId));

    await completeCheckout(harness, paid, userId);

    expect(await statusOf(paid, userId)).toBe("active");
    expect(await useCount(inviteId)).toBe(1);
    expect(harness.logs).toContainEqual(
      expect.objectContaining({ msg: "payer admitted past the invite limit", inviteId }),
    );
  });

  it("settles a hold release and a Checkout completing at the same moment without a deadlock", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const held = await Promise.all(
      Array.from({ length: 6 }, () => invited(paid, new Date(harness.clock.now.getTime() - 1), 1)),
    );

    await Promise.all([
      harness.service.expireMembershipHolds(),
      ...held.map(({ userId }) => completeCheckout(harness, paid, userId)),
    ]);

    for (const { userId, inviteId } of held) {
      expect(await statusOf(paid, userId)).toBe("active");
      expect(await useCount(inviteId)).toBe(1);
      expect(await holdOf(paid, userId)).toBeNull();
    }
  });

  it("keeps a hold that has not expired yet", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() + hour));

    await harness.service.expireMembershipHolds();

    expect(await statusOf(paid, userId)).toBe("pending");
    expect(await useCount(inviteId)).toBe(1);
  });

  it("keeps an expired hold while a subscription is in flight and retries in an hour", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() - 1));
    const subscription = stripeSubscription(paid, userId, { status: "incomplete" });
    harness.gateway.subscriptions.set(subscription.id, subscription);
    await webhook(harness, paid, "customer.subscription.created", {
      id: subscription.id,
      object: "subscription",
    });

    await harness.service.expireMembershipHolds();

    expect(await statusOf(paid, userId)).toBe("pending");
    expect(await useCount(inviteId)).toBe(1);
    expect((await holdOf(paid, userId))?.expiresAt).toEqual(
      new Date(harness.clock.now.getTime() + hour),
    );
  });

  it("releases the hold early when Stripe reports the Checkout Session expired", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() + hour));
    await harness.service.createCheckoutSession(user(userId), paid.communityId);
    harness.clock.now = new Date(harness.clock.now.getTime() + 24 * hour);

    const expired = {
      id: `cs_${newId()}`,
      object: "checkout.session",
      mode: "subscription",
      metadata: { cohory_community_id: paid.communityId, cohory_user_id: userId },
    };
    await webhook(harness, paid, "checkout.session.expired", expired);

    expect(await statusOf(paid, userId)).toBe("removed");
    expect(await useCount(inviteId)).toBe(0);
  });

  it("clears the hold when the subscription activates the membership", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const { userId, inviteId } = await invited(paid, new Date(harness.clock.now.getTime() + hour));
    const subscription = stripeSubscription(paid, userId);
    harness.gateway.subscriptions.set(subscription.id, subscription);

    await webhook(harness, paid, "checkout.session.completed", {
      id: `cs_${subscription.id}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: subscription.id,
      customer: subscription.customerId,
      metadata: subscription.metadata,
    });
    harness.clock.now = new Date(harness.clock.now.getTime() + 2 * hour);
    await harness.service.expireMembershipHolds();

    expect(await statusOf(paid, userId)).toBe("active");
    expect(await holdOf(paid, userId)).toBeNull();
    expect(await useCount(inviteId)).toBe(1);
  });
});

describe("test checkout", () => {
  it("records the first completed test mode checkout for the setup checklist", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const completed = {
      id: `cs_${subscription.id}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: subscription.id,
      customer: subscription.customerId,
      metadata: subscription.metadata,
    };

    await webhook(harness, paid, "checkout.session.completed", completed);
    const first = harness.clock.now;
    harness.clock.now = new Date(first.getTime() + hour);
    await webhook(harness, paid, "checkout.session.completed", { ...completed, id: "cs_again" });

    const [row] = await admin.db
      .select({ at: communities.testCheckoutSucceededAt })
      .from(communities)
      .where(eq(communities.id, paid.communityId));
    expect(row?.at).toEqual(first);
  });
});
