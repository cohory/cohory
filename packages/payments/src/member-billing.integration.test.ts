import { getMembership, withCommunity, type Database } from "@cohory/db";
import { membershipPlans, posts, subscriptions } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipChangeUnavailableError, PaymentsValidationError } from "./errors";
import type { GatewaySubscription } from "./gateway";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { openProbeDb, openTestDb, user } from "./test/fixtures";
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

const periodEnd = new Date("2026-11-18T10:00:00.000Z");

async function webhook(
  harness: Harness,
  paid: PaidCommunity,
  type: string,
  subscriptionId: string,
) {
  const event = signedEvent(
    type,
    { id: subscriptionId, object: "subscription" },
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
}

async function subscribed(
  overrides: Partial<GatewaySubscription> = {},
): Promise<{ harness: Harness; paid: PaidCommunity; subscription: GatewaySubscription }> {
  const harness = createHarness(probe.db);
  harness.clock.now = new Date("2026-10-22T10:00:00.000Z");
  const paid = await setupPaidCommunity(admin.db, harness);
  const subscription = stripeSubscription(paid, paid.buyerId, {
    currentPeriodEnd: periodEnd,
    ...overrides,
  });
  harness.gateway.subscriptions.set(subscription.id, subscription);
  await webhook(harness, paid, "customer.subscription.created", subscription.id);
  return { harness, paid, subscription };
}

function stateKey(operation: string): RegExp {
  return new RegExp(`^${operation}:[0-9a-f-]{36}:\\d+:`);
}

async function membershipStatus(paid: PaidCommunity) {
  return (await getMembership(withCommunity(admin.db, paid.communityId), paid.buyerId))?.status;
}

describe("cancel screen", () => {
  it("shows what the member used, when access ends, the price, and the yearly saving", async () => {
    const { harness, paid } = await subscribed();
    await admin.db.insert(posts).values({
      communityId: paid.communityId,
      authorId: paid.buyerId,
      body: { type: "doc", content: [] },
      bodyHtml: "",
      bodyText: "",
      excerpt: "",
    });

    const overview = await harness.service.getCancelOverview(user(paid.buyerId), paid.communityId);

    expect(overview).toEqual({
      communityName: "Paid circle",
      accessEndsAt: periodEnd,
      usage: { lessonsDone: 0, eventsAttended: 0, posts: 1 },
      price: { amountMinor: 4900, currency: "usd", interval: "month" },
      yearly: { annualPriceMinor: 49_000, savingMinor: 9800, currency: "usd" },
      canPause: true,
    });
  });

  it("refuses the cancel screen to a member whose membership already ends", async () => {
    const { harness, paid } = await subscribed({ cancelAtPeriodEnd: true });

    await expect(
      harness.service.getCancelOverview(user(paid.buyerId), paid.communityId),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
  });

  it("sends the reason to Stripe and opens the portal on the cancel flow", async () => {
    const { harness, paid, subscription } = await subscribed();

    const redirect = await harness.service.cancelMembership(user(paid.buyerId), paid.communityId, {
      feedback: "too_expensive",
      comment: "  Money is tight  ",
    });

    const [reason] = harness.gateway.writes("setCancellationDetails");
    expect(reason?.input).toEqual({
      subscriptionId: subscription.id,
      feedback: "too_expensive",
      comment: "Money is tight",
    });
    expect(reason?.idempotencyKey).toMatch(stateKey("cancel-reason"));
    const [portal] = harness.gateway.writes("createPortalSession");
    expect(portal?.input).toMatchObject({
      flow: { type: "subscription_cancel", subscriptionId: subscription.id },
    });
    expect(portal?.idempotencyKey).toBeTruthy();
    expect(redirect.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
  });

  it("opens the cancel flow without a Stripe write when no reason is given", async () => {
    const { harness, paid } = await subscribed();

    await harness.service.cancelMembership(user(paid.buyerId), paid.communityId);

    expect(harness.gateway.writes("setCancellationDetails")).toEqual([]);
    expect(harness.gateway.writes("createPortalSession")).toHaveLength(1);
  });

  it("opens a fresh portal session when the member comes back after five minutes", async () => {
    const { harness, paid } = await subscribed();

    await harness.service.cancelMembership(user(paid.buyerId), paid.communityId);
    harness.clock.now = new Date(harness.clock.now.getTime() + 6 * 60 * 1000);
    await harness.service.cancelMembership(user(paid.buyerId), paid.communityId);

    const keys = harness.gateway.writes("createPortalSession").map((write) => write.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("opens the portal to confirm the yearly price for a monthly member only", async () => {
    const monthly = await subscribed();
    await monthly.harness.service.switchToYearly(
      user(monthly.paid.buyerId),
      monthly.paid.communityId,
    );
    const [portal] = monthly.harness.gateway.writes("createPortalSession");
    expect(portal?.input).toMatchObject({
      flow: { type: "subscription_update_confirm", subscriptionId: monthly.subscription.id },
    });

    const yearly = await subscribed({ interval: "year" });
    await expect(
      yearly.harness.service.switchToYearly(user(yearly.paid.buyerId), yearly.paid.communityId),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
  });
});

describe("pause", () => {
  it("pauses payments for the chosen months and keeps access through the paid period", async () => {
    const { harness, paid, subscription } = await subscribed();

    const result = await harness.service.pauseMembership(user(paid.buyerId), paid.communityId, {
      months: 2,
    });

    expect(result).toEqual({
      accessUntil: periodEnd,
      resumesAt: new Date("2027-01-18T10:00:00.000Z"),
    });
    const [write] = harness.gateway.writes("pauseSubscription");
    expect(write?.input).toEqual({
      subscriptionId: subscription.id,
      resumesAt: new Date("2027-01-18T10:00:00.000Z"),
      paidThrough: periodEnd,
    });
    expect(write?.idempotencyKey).toMatch(stateKey("pause"));
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.paused).toBe(true);
    expect(mine.access).toMatchObject({ level: "member", currentPeriodEnd: periodEnd });
    expect(await membershipStatus(paid)).toBe("active");
  });

  it("refuses a pause length the screen does not offer", async () => {
    const { harness, paid } = await subscribed();

    await expect(
      harness.service.pauseMembership(user(paid.buyerId), paid.communityId, {
        months: 4 as 1,
      }),
    ).rejects.toBeInstanceOf(PaymentsValidationError);
    expect(harness.gateway.writes("pauseSubscription")).toEqual([]);
  });

  it.each([
    ["a yearly membership", { interval: "year" as const }],
    ["a membership that already ends", { cancelAtPeriodEnd: true }],
    ["a membership whose payment failed", { status: "past_due" }],
  ])("refuses to pause %s", async (_name, overrides) => {
    const { harness, paid } = await subscribed(overrides);

    await expect(
      harness.service.pauseMembership(user(paid.buyerId), paid.communityId, { months: 1 }),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
    expect(harness.gateway.writes("pauseSubscription")).toEqual([]);
  });

  it("removes the member when the paid period ends during a pause and restores them on resume", async () => {
    const { harness, paid, subscription } = await subscribed();
    await harness.service.pauseMembership(user(paid.buyerId), paid.communityId, { months: 1 });

    harness.clock.now = new Date(periodEnd.getTime() + 60_000);
    await webhook(harness, paid, "customer.subscription.updated", subscription.id);
    await webhook(harness, paid, "customer.subscription.updated", subscription.id);
    expect(await membershipStatus(paid)).toBe("removed");

    await harness.service.resumeMembership(user(paid.buyerId), paid.communityId);
    expect(harness.gateway.writes("resumeSubscription")).toHaveLength(1);
    expect(await membershipStatus(paid)).toBe("active");
  });

  it("sends a fresh idempotency key when the member pauses again right after resuming", async () => {
    const { harness, paid } = await subscribed();
    const member = user(paid.buyerId);

    await harness.service.pauseMembership(member, paid.communityId, { months: 1 });
    await harness.service.resumeMembership(member, paid.communityId);
    await harness.service.pauseMembership(member, paid.communityId, { months: 1 });

    const keys = harness.gateway.writes("pauseSubscription").map((write) => write.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(harness.gateway.writes("resumeSubscription")[0]?.idempotencyKey).toMatch(
      stateKey("resume"),
    );
  });

  it("refuses to resume a membership that is not paused", async () => {
    const { harness, paid } = await subscribed();

    await expect(
      harness.service.resumeMembership(user(paid.buyerId), paid.communityId),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
  });
});

describe("authorization", () => {
  it("never lets one member pause, cancel, or resume another member's subscription", async () => {
    const { harness, paid } = await subscribed();
    const other = user(paid.memberId);

    await expect(
      harness.service.pauseMembership(other, paid.communityId, { months: 1 }),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
    await expect(
      harness.service.cancelMembership(other, paid.communityId, { feedback: "other" }),
    ).rejects.toBeInstanceOf(MembershipChangeUnavailableError);
    await expect(harness.service.resumeMembership(other, paid.communityId)).rejects.toBeInstanceOf(
      MembershipChangeUnavailableError,
    );
    expect(harness.gateway.writes("pauseSubscription")).toEqual([]);
    expect(harness.gateway.writes("setCancellationDetails")).toEqual([]);
    expect(harness.gateway.writes("createPortalSession")).toEqual([]);
    expect(harness.gateway.writes("resumeSubscription")).toEqual([]);
  });

  it("refuses a member of another community", async () => {
    const { harness, paid } = await subscribed();
    const elsewhere = await setupPaidCommunity(admin.db, harness);

    await expect(
      harness.service.pauseMembership(user(elsewhere.memberId), paid.communityId, { months: 1 }),
    ).rejects.toThrow();
    expect(harness.gateway.writes("pauseSubscription")).toEqual([]);
  });
});

describe("membership view", () => {
  it("shows the price and suggests yearly only after two paid months", async () => {
    const { harness, paid } = await subscribed({ currentPeriodEnd: new Date("2099-01-01") });
    harness.clock.now = new Date();

    const fresh = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    harness.clock.now = new Date(harness.clock.now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const later = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);

    expect(fresh.price).toEqual({ amountMinor: 4900, currency: "usd", interval: "month" });
    expect(fresh.suggestYearly).toBe(false);
    expect(later.suggestYearly).toBe(true);
  });
});

describe("plan versions", () => {
  async function planRow(planId: string) {
    const [row] = await admin.db
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.id, planId));
    if (!row) throw new Error("plan not found");
    return row;
  }

  it("prices a yearly switch from the plan that sells the new Stripe price", async () => {
    const harness = createHarness(probe.db);
    harness.clock.now = new Date("2026-10-22T10:00:00.000Z");
    const paid = await setupPaidCommunity(admin.db, harness);
    const owner = user(paid.ownerId);
    const monthlyOnly = await harness.service.upsertPlan(owner, paid.communityId, {
      currency: "USD",
      monthlyPriceMinor: 2900,
      annualPriceMinor: null,
    });
    const planA = await planRow(monthlyOnly.id);
    const subscription = stripeSubscription(paid, paid.buyerId, {
      metadata: {
        cohory_community_id: paid.communityId,
        cohory_user_id: paid.buyerId,
        cohory_plan_id: planA.id,
      },
      priceId: planA.providerMonthlyPriceId,
      currentPeriodEnd: periodEnd,
    });
    harness.gateway.subscriptions.set(subscription.id, subscription);
    await webhook(harness, paid, "customer.subscription.created", subscription.id);
    const withYearly = await harness.service.upsertPlan(owner, paid.communityId, {
      currency: "USD",
      monthlyPriceMinor: 2900,
      annualPriceMinor: 29_000,
    });
    const planB = await planRow(withYearly.id);

    harness.gateway.subscriptions.set(subscription.id, {
      ...subscription,
      interval: "year",
      priceId: planB.providerAnnualPriceId,
      currentPeriodEnd: new Date("2027-10-22T10:00:00.000Z"),
    });
    await webhook(harness, paid, "customer.subscription.updated", subscription.id);

    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(planB.providerAnnualPriceId).not.toBeNull();
    expect(mine.price).toEqual({ amountMinor: 29_000, currency: "usd", interval: "year" });
  });
});

describe("prices no plan sells", () => {
  async function storedPlanId(externalId: string) {
    const [row] = await admin.db
      .select({ planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.externalSubscriptionId, externalId));
    return row?.planId;
  }

  it("keeps the stored plan when the price moves to one no plan sells, and logs it", async () => {
    const { harness, paid, subscription } = await subscribed();
    harness.gateway.subscriptions.set(subscription.id, {
      ...subscription,
      priceId: "price_made_in_dashboard",
    });

    await webhook(harness, paid, "customer.subscription.updated", subscription.id);

    expect(await storedPlanId(subscription.id)).toBe(paid.planId);
    expect(harness.logs).toContainEqual(
      expect.objectContaining({
        msg: "subscription price matches no plan",
        priceId: "price_made_in_dashboard",
      }),
    );
  });

  it("records no plan for a new subscription on a price no plan sells", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscription = stripeSubscription(paid, paid.buyerId, {
      priceId: "price_made_in_dashboard",
    });
    harness.gateway.subscriptions.set(subscription.id, subscription);

    await webhook(harness, paid, "customer.subscription.created", subscription.id);

    expect(await storedPlanId(subscription.id)).toBeNull();
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.price).toBeNull();
  });
});
