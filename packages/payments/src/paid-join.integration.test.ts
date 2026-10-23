import { ForbiddenError } from "@cohory/authz";
import { getCommunityById, getMembership, newId, withCommunity, type Database } from "@cohory/db";
import { communities, memberships, pendingJoinAnswers } from "@cohory/db/schema";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InviteRequiredError, PaymentsValidationError, PlanConflictError } from "./errors";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { insertCommunity, insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
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

const draftPrice = { currency: "usd", monthlyPriceMinor: 1500, annualPriceMinor: null };

async function readyConnection(harness: Harness, ownerId: string, communityId: string) {
  const owner = user(ownerId);
  const { connection } = await harness.service.connectStripe(owner, communityId, {
    acceptCreatorTerms: true,
  });
  const accountId = connection.externalAccountId ?? "";
  harness.gateway.accounts.set(accountId, {
    id: accountId,
    chargesEnabled: true,
    detailsSubmitted: true,
    livemode: false,
    country: "us",
  });
  await harness.service.refreshConnection(owner, communityId);
}

async function setCommunity(
  communityId: string,
  patch: Partial<typeof communities.$inferInsert>,
): Promise<void> {
  await admin.db.update(communities).set(patch).where(eq(communities.id, communityId));
}

async function pendingAnswers(paid: PaidCommunity, userId: string) {
  return admin.db
    .select({ answers: pendingJoinAnswers.answers })
    .from(pendingJoinAnswers)
    .where(
      and(
        eq(pendingJoinAnswers.communityId, paid.communityId),
        eq(pendingJoinAnswers.userId, userId),
      ),
    );
}

async function completeCheckout(
  harness: Harness,
  paid: PaidCommunity,
  userId: string,
  overrides: Parameters<typeof stripeSubscription>[2] = {},
) {
  const subscription = stripeSubscription(paid, userId, overrides);
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
  return subscription;
}

async function lapse(
  harness: Harness,
  paid: PaidCommunity,
  userId: string,
  overrides: Parameters<typeof stripeSubscription>[2] = {},
) {
  const subscription = await completeCheckout(harness, paid, userId, overrides);
  harness.gateway.subscriptions.set(subscription.id, { ...subscription, status: "canceled" });
  harness.clock.now = new Date(harness.clock.now.getTime() + 1000);
  const cancel = signedEvent(
    "customer.subscription.deleted",
    { id: subscription.id, object: "subscription" },
    { account: paid.accountId },
  );
  const result = await harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: cancel.rawBody,
      signature: cancel.signature,
    }),
  );
  expect(result.status).toBe(200);
}

describe("draft plans", () => {
  it("saves a draft price before any payment account exists without selling it", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");

    const saved = await harness.service.upsertPlan(user(ownerId), communityId, draftPrice);

    expect(saved).toMatchObject({ monthlyPriceMinor: 1500, purchasable: false });
    expect(await harness.service.getPlan({ kind: "guest" }, communityId)).toBeNull();
    expect(await harness.service.getDraftPlan(user(ownerId), communityId)).toMatchObject({
      currency: "usd",
      monthlyPriceMinor: 1500,
    });
    expect((await getCommunityById(admin.db, communityId))?.currency).toBeNull();
    expect(harness.gateway.writes("createProduct")).toEqual([]);
  });

  it("updates the draft in place when the owner changes the price again", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));

    const first = await harness.service.upsertPlan(owner, communityId, draftPrice);
    const second = await harness.service.upsertPlan(owner, communityId, {
      currency: "eur",
      monthlyPriceMinor: 2000,
      annualPriceMinor: 20_000,
    });

    expect(second.id).toBe(first.id);
    expect(await harness.service.getDraftPlan(owner, communityId)).toMatchObject({
      currency: "eur",
      monthlyPriceMinor: 2000,
      annualPriceMinor: 20_000,
    });
  });

  it("keeps a free community free for its members while a draft exists", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const memberId = await insertMember(admin.db, communityId, "member");

    await harness.service.upsertPlan(user(ownerId), communityId, draftPrice);

    expect(await harness.service.hasActiveMembership(communityId, memberId)).toBe(true);
    expect(
      await getCommunityAccess(withCommunity(admin.db, communityId), memberId, new Date()),
    ).toEqual({ role: "member", entitled: true });
  });

  it("puts the draft on sale once the payment account is ready", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const owner = user(ownerId);
    await harness.service.upsertPlan(owner, communityId, draftPrice);
    await readyConnection(harness, ownerId, communityId);

    await harness.service.upsertPlan(owner, communityId, draftPrice);

    expect(await harness.service.getPlan({ kind: "guest" }, communityId)).toMatchObject({
      monthlyPriceMinor: 1500,
      purchasable: true,
    });
    expect(await harness.service.getDraftPlan(owner, communityId)).toBeNull();
    expect((await getCommunityById(admin.db, communityId))?.currency).toBe("usd");
  });

  it("answers a plain conflict when a second plan is saved at the same time", async () => {
    const communityId = await insertCommunity(admin.db);
    const repo = createPostgresPaymentsRepository(probe.db);
    const plan = (id: string) => ({
      id,
      connectionId: null,
      name: "Membership",
      ...draftPrice,
    });
    await repo.inCommunityAsSystem(communityId, (store) => store.insertPlan(plan(newId())));

    await expect(
      repo.inCommunityAsSystem(communityId, (store) => store.insertPlan(plan(newId()))),
    ).rejects.toThrow(PlanConflictError);
  });

  it("discards a draft", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    await harness.service.upsertPlan(owner, communityId, draftPrice);

    await harness.service.archivePlan(owner, communityId);

    expect(await harness.service.getDraftPlan(owner, communityId)).toBeNull();
  });

  it("shows the draft only to people who may change pricing", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const adminId = await insertMember(admin.db, communityId, "admin");
    await harness.service.upsertPlan(owner, communityId, draftPrice);

    await expect(harness.service.getDraftPlan(user(adminId), communityId)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      harness.service.upsertPlan(user(adminId), communityId, draftPrice),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("join rules for paid communities", () => {
  it("turns approval into open joining when a plan goes on sale", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await setCommunity(communityId, { joinMode: "approval" });
    await readyConnection(harness, ownerId, communityId);

    await harness.service.upsertPlan(user(ownerId), communityId, draftPrice);

    expect((await getCommunityById(admin.db, communityId))?.joinMode).toBe("open");
  });

  it("keeps invite only when a plan goes on sale", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await setCommunity(communityId, { joinMode: "invite" });
    await readyConnection(harness, ownerId, communityId);

    await harness.service.upsertPlan(user(ownerId), communityId, draftPrice);

    expect((await getCommunityById(admin.db, communityId))?.joinMode).toBe("invite");
  });

  it("refuses checkout in an invite only community to someone without an invite", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, { joinMode: "invite" });

    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow(InviteRequiredError);
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
    expect(
      (await harness.service.getMyMembership(user(paid.buyerId), paid.communityId)).inviteRequired,
    ).toBe(true);
  });

  it("lets a person who used an invite check out in an invite only community", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, { joinMode: "invite" });
    const invitedId = await insertMember(admin.db, paid.communityId, "member", "pending");

    await harness.service.createCheckoutSession(user(invitedId), paid.communityId);

    expect(harness.gateway.writes("createCheckoutSession")).toHaveLength(1);
    expect(
      (await harness.service.getMyMembership(user(invitedId), paid.communityId)).inviteRequired,
    ).toBe(false);
  });

  it("refuses checkout until required join questions are answered", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, {
      joinQuestions: [{ text: "What brings you here?", required: true }],
    });

    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
        answers: ["  "],
      }),
    ).rejects.toThrow(PaymentsValidationError);
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
  });

  it("keeps the answers with the pending checkout and attaches them on activation", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, {
      joinQuestions: [
        { text: "What brings you here?", required: true },
        { text: "Where are you based?", required: false },
      ],
    });

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
      answers: ["To learn pottery ", ""],
    });
    const stored = [
      { question: "What brings you here?", answer: "To learn pottery" },
      { question: "Where are you based?", answer: "" },
    ];
    expect(await pendingAnswers(paid, paid.buyerId)).toEqual([{ answers: stored }]);

    await completeCheckout(harness, paid, paid.buyerId);

    const membership = await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId);
    expect(membership).toMatchObject({ status: "active", joinAnswers: stored });
    expect(await pendingAnswers(paid, paid.buyerId)).toEqual([]);
  });

  it("does not store answers when the community asks no questions", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    await completeCheckout(harness, paid, paid.buyerId);

    const [row] = await admin.db
      .select({ joinAnswers: memberships.joinAnswers })
      .from(memberships)
      .where(
        and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, paid.buyerId)),
      );
    expect(row).toEqual({ joinAnswers: null });
    expect(await pendingAnswers(paid, paid.buyerId)).toEqual([]);
  });

  it("lets a member who cancelled at period end subscribe again without the questions", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, {
      joinQuestions: [{ text: "What brings you here?", required: true }],
    });
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
      answers: ["Pottery"],
    });
    await lapse(harness, paid, paid.buyerId, { cancelAtPeriodEnd: true });

    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    expect(mine.asksJoinQuestions).toBe(false);
    expect(harness.gateway.writes("createCheckoutSession")).toHaveLength(2);
  });

  it("asks the questions of someone who never joined", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, {
      joinQuestions: [{ text: "What brings you here?", required: true }],
    });

    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);

    expect(mine.asksJoinQuestions).toBe(true);
  });

  it("forgets earlier answers when checkout starts again without any", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await setCommunity(paid.communityId, {
      joinQuestions: [{ text: "Where are you based?", required: false }],
    });
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
      answers: ["Lisbon"],
    });
    await setCommunity(paid.communityId, { joinQuestions: [] });

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    expect(await pendingAnswers(paid, paid.buyerId)).toEqual([]);
  });

  it("lets a lapsed member of an invite only community pay again without a new invite", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await lapse(harness, paid, paid.buyerId);
    await setCommunity(paid.communityId, { joinMode: "invite" });
    expect(
      (await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId))?.status,
    ).toBe("removed");

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    expect(harness.gateway.writes("createCheckoutSession")).toHaveLength(1);
    expect(
      (await harness.service.getMyMembership(user(paid.buyerId), paid.communityId)).inviteRequired,
    ).toBe(false);
  });

  it("still refuses a banned former member of an invite only community", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await lapse(harness, paid, paid.buyerId);
    await setCommunity(paid.communityId, { joinMode: "invite" });
    await admin.db
      .update(memberships)
      .set({ status: "banned" })
      .where(
        and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, paid.buyerId)),
      );

    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow(ForbiddenError);
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
  });
});

describe("paid members list", () => {
  it("shows what each member pays and links to the subscription in Stripe", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = await completeCheckout(harness, paid, paid.buyerId);

    const [row] = await harness.service.listSubscriptions(user(paid.ownerId), paid.communityId);

    expect(row).toMatchObject({
      userId: paid.buyerId,
      interval: "month",
      amountMinor: 4900,
      currency: "usd",
      dashboardUrl: `https://dashboard.stripe.com/${paid.accountId}/test/subscriptions/${subscription.id}`,
    });
  });
});
