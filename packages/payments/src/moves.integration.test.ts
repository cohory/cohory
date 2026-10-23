import { ForbiddenError } from "@cohory/authz";
import type { Database } from "@cohory/db";
import {
  compedMemberships,
  paymentConnections,
  subscriberMoves,
  subscriptionLinks,
  users,
} from "@cohory/db/schema";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AlreadySubscribedError, PaymentsValidationError } from "./errors";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import {
  cloudEnv,
  communityEnv,
  insertMember,
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

const day = 24 * 60 * 60 * 1000;

async function emailOf(userId: string): Promise<string> {
  const [row] = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email ?? "";
}

async function setup(): Promise<{ harness: Harness; paid: PaidCommunity }> {
  const harness = createHarness(probe.db);
  return { harness, paid: await setupPaidCommunity(admin.db, harness) };
}

function daysFrom(harness: Harness, days: number): Date {
  return new Date(harness.clock.now.getTime() + days * day);
}

async function addMove(
  harness: Harness,
  paid: PaidCommunity,
  userId: string,
  freeUntil: Date | null,
) {
  return harness.service.addSubscriberMoves(user(paid.ownerId), paid.communityId, {
    source: "skool",
    rows: [{ email: (await emailOf(userId)).toUpperCase(), freeUntil }],
  });
}

async function deliverSubscription(harness: Harness, paid: PaidCommunity, userId: string) {
  const subscription = stripeSubscription(paid, userId, { status: "trialing" });
  harness.gateway.subscriptions.set(subscription.id, subscription);
  const event = signedEvent(
    "customer.subscription.created",
    { id: subscription.id, object: "subscription" },
    { account: paid.accountId },
  );
  for (let delivery = 0; delivery < 2; delivery += 1) {
    const result = await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery({
        rawBody: event.rawBody,
        signature: event.signature,
      }),
    );
    expect(result.status).toBe(200);
  }
  return subscription;
}

describe("free time for moving members", () => {
  it("ends the Checkout trial at the old renewal date", async () => {
    const { harness, paid } = await setup();
    const renewal = daysFrom(harness, 20);
    await addMove(harness, paid, paid.buyerId, renewal);

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: renewal });
  });

  it("charges at once when the old renewal date is less than 48 hours away", async () => {
    const { harness, paid } = await setup();
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 1));

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: null });
  });

  it("lets a member who already has free access subscribe when they are moving", async () => {
    const { harness, paid } = await setup();
    await expect(
      harness.service.createCheckoutSession(user(paid.memberId), paid.communityId),
    ).rejects.toThrow(AlreadySubscribedError);
    const renewal = daysFrom(harness, 9);
    await addMove(harness, paid, paid.memberId, renewal);

    const membership = await harness.service.getMyMembership(user(paid.memberId), paid.communityId);
    await harness.service.createCheckoutSession(user(paid.memberId), paid.communityId);

    expect(membership.resubscribe).toEqual({ endsAt: renewal });
    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: renewal });
  });

  it("gives no free time to an account whose email is not confirmed when confirmation is required", async () => {
    const { harness: setupHarness, paid } = await setup();
    await addMove(setupHarness, paid, paid.buyerId, daysFrom(setupHarness, 20));
    const harness = createHarness(probe.db, cloudEnv(), null, { requireConfirmedEmail: true });

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: null });

    await admin.db.update(users).set({ emailVerified: true }).where(eq(users.id, paid.buyerId));
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: daysFrom(harness, 20) });
  });

  it("marks the member moved once the new subscription starts, even on a repeated event", async () => {
    const { harness, paid } = await setup();
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 20));

    await deliverSubscription(harness, paid, paid.buyerId);
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 40));

    const [row] = await harness.service.listSubscriberMoves(user(paid.ownerId), paid.communityId);
    expect(row).toMatchObject({
      email: await emailOf(paid.buyerId),
      state: "moved",
      freeUntil: daysFrom(harness, 20),
      resubscribedAt: harness.clock.now,
    });
    const [stored] = await admin.db
      .select({ subscriptionId: subscriberMoves.subscriptionId })
      .from(subscriberMoves)
      .where(eq(subscriberMoves.communityId, paid.communityId));
    expect(stored?.subscriptionId).not.toBeNull();
  });
});

describe("the list of paying members to move", () => {
  it("shows each person once with whether they moved or their free time ended", async () => {
    const { harness, paid } = await setup();
    const owner = user(paid.ownerId);
    await harness.service.addSubscriberMoves(owner, paid.communityId, {
      rows: [
        { email: "later@example.test", freeUntil: daysFrom(harness, 5) },
        { email: "ended@example.test", freeUntil: daysFrom(harness, -1) },
        { email: "undated@example.test" },
      ],
    });
    const again = await harness.service.addSubscriberMoves(owner, paid.communityId, {
      rows: [{ email: "Undated@example.test", freeUntil: daysFrom(harness, 3) }],
    });

    const rows = await harness.service.listSubscriberMoves(owner, paid.communityId);

    expect(again).toEqual({ saved: 1 });
    expect(
      Object.fromEntries(rows.map((row) => [row.email, [row.state, row.freeUntil, row.source]])),
    ).toEqual({
      "later@example.test": ["not_moved", daysFrom(harness, 5), "manual"],
      "ended@example.test": ["free_time_ended", daysFrom(harness, -1), "manual"],
      "undated@example.test": ["not_moved", daysFrom(harness, 3), "manual"],
    });
  });

  it("refuses free time longer than two years", async () => {
    const { harness, paid } = await setup();
    await expect(
      harness.service.addSubscriberMoves(user(paid.ownerId), paid.communityId, {
        rows: [{ email: "far@example.test", freeUntil: daysFrom(harness, 731) }],
      }),
    ).rejects.toThrow(PaymentsValidationError);
  });

  it("is kept by owners and admins only, and stays inside its community", async () => {
    const { harness, paid } = await setup();
    const other = await setupPaidCommunity(admin.db, harness);
    await harness.service.addSubscriberMoves(user(paid.adminId), paid.communityId, {
      rows: [{ email: "admin-added@example.test" }],
    });
    const moderatorId = await insertMember(admin.db, paid.communityId, "moderator");

    for (const id of [moderatorId, paid.memberId, paid.buyerId, other.ownerId]) {
      await expect(harness.service.listSubscriberMoves(user(id), paid.communityId)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        harness.service.addSubscriberMoves(user(id), paid.communityId, {
          rows: [{ email: "intruder@example.test" }],
        }),
      ).rejects.toThrow(ForbiddenError);
      await expect(harness.service.claimMoveReminders(user(id), paid.communityId)).rejects.toThrow(
        ForbiddenError,
      );
    }
    expect(
      await harness.service.listSubscriberMoves(user(other.ownerId), other.communityId),
    ).toEqual([]);
    expect(
      (await harness.service.listSubscriberMoves(user(paid.ownerId), paid.communityId)).map(
        (row) => row.email,
      ),
    ).toEqual(["admin-added@example.test"]);
  });

  it("hands out a reminder for each person not yet moved at most once a week", async () => {
    const { harness, paid } = await setup();
    const owner = user(paid.ownerId);
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 20));
    await harness.service.addSubscriberMoves(owner, paid.communityId, {
      rows: [{ email: "waiting@example.test", freeUntil: daysFrom(harness, 10) }],
    });
    await deliverSubscription(harness, paid, paid.buyerId);

    const first = await harness.service.claimMoveReminders(owner, paid.communityId);
    const again = await harness.service.claimMoveReminders(owner, paid.communityId);
    harness.clock.now = daysFrom(harness, 6.5);
    const sixDaysLater = await harness.service.claimMoveReminders(owner, paid.communityId);
    harness.clock.now = daysFrom(harness, 0.6);
    const aWeekLater = await harness.service.claimMoveReminders(owner, paid.communityId);

    expect(first).toEqual([
      { email: "waiting@example.test", source: "manual", freeUntil: daysFrom(harness, 2.9) },
    ]);
    expect(again).toEqual([]);
    expect(sixDaysLater).toEqual([]);
    expect(aWeekLater.map((reminder) => reminder.email)).toEqual(["waiting@example.test"]);
  });

  it("stops reminding a week after the free time ends, or 30 days after an undated row was added", async () => {
    const { harness, paid } = await setup();
    const owner = user(paid.ownerId);
    await harness.service.addSubscriberMoves(owner, paid.communityId, {
      rows: [
        { email: "just-ended@example.test", freeUntil: daysFrom(harness, -6) },
        { email: "long-ended@example.test", freeUntil: daysFrom(harness, -8) },
        { email: "undated@example.test" },
      ],
    });

    const today = await harness.service.claimMoveReminders(owner, paid.communityId);
    harness.clock.now = daysFrom(harness, 31);
    const monthLater = await harness.service.claimMoveReminders(owner, paid.communityId);

    expect(today.map((reminder) => reminder.email).sort()).toEqual([
      "just-ended@example.test",
      "undated@example.test",
    ]);
    expect(monthLater).toEqual([]);
    const [longEnded] = await admin.db
      .select({ remindedAt: subscriberMoves.remindedAt })
      .from(subscriberMoves)
      .where(eq(subscriberMoves.email, "long-ended@example.test"));
    expect(longEnded?.remindedAt).toBeNull();
  });

  it("hands each reminder to only one of two clicks at the same time", async () => {
    const { harness, paid } = await setup();
    const owner = user(paid.ownerId);
    const emails = Array.from({ length: 40 }, (_, index) => `same-time-${index}@example.test`);
    await harness.service.addSubscriberMoves(owner, paid.communityId, {
      rows: emails.map((email) => ({ email, freeUntil: daysFrom(harness, 10) })),
    });

    const [left, right] = await Promise.all([
      harness.service.claimMoveReminders(owner, paid.communityId),
      harness.service.claimMoveReminders(user(paid.adminId), paid.communityId),
    ]);

    const claimed = [...left, ...right].map((reminder) => reminder.email);
    expect(claimed.sort()).toEqual([...emails].sort());
  });

  it("caps the list at 5,000 people per community", async () => {
    const { harness, paid } = await setup();
    await admin.db.insert(subscriberMoves).values(
      Array.from({ length: 5000 }, (_, index) => ({
        communityId: paid.communityId,
        email: `listed-${index}@example.test`,
        source: "manual" as const,
      })),
    );
    const owner = user(paid.ownerId);

    await expect(
      harness.service.addSubscriberMoves(owner, paid.communityId, {
        rows: [{ email: "one-more@example.test" }],
      }),
    ).rejects.toThrow(PaymentsValidationError);
    await expect(
      harness.service.addSubscriberMoves(owner, paid.communityId, {
        rows: [{ email: "listed-7@example.test", freeUntil: daysFrom(harness, 5) }],
      }),
    ).resolves.toEqual({ saved: 1 });
  });

  it("keeps two pastes at the same time within the community cap", async () => {
    const { harness, paid } = await setup();
    await admin.db.insert(subscriberMoves).values(
      Array.from({ length: 4990 }, (_, index) => ({
        communityId: paid.communityId,
        email: `full-${index}@example.test`,
        source: "manual" as const,
      })),
    );
    const paste = (prefix: string, actorId: string) =>
      harness.service.addSubscriberMoves(user(actorId), paid.communityId, {
        rows: Array.from({ length: 10 }, (_, index) => ({
          email: `${prefix}-${index}@example.test`,
        })),
      });

    const results = await Promise.allSettled([
      paste("left", paid.ownerId),
      paste("right", paid.adminId),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [total] = await admin.db
      .select({ value: count() })
      .from(subscriberMoves)
      .where(eq(subscriberMoves.communityId, paid.communityId));
    expect(total?.value).toBe(5000);
  });
});

describe("keeping moving offers no longer than needed", () => {
  it("forgets the moves and link invitations for an erased account's email", async () => {
    const { harness, paid } = await setup();
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 20));
    await harness.service.addSubscriberMoves(user(paid.ownerId), paid.communityId, {
      rows: [{ email: "someone-else@example.test" }],
    });
    const [connection] = await admin.db
      .select({ id: paymentConnections.id })
      .from(paymentConnections)
      .where(eq(paymentConnections.communityId, paid.communityId));
    if (!connection) throw new Error("no connection");
    const [link] = await admin.db
      .insert(subscriptionLinks)
      .values({
        communityId: paid.communityId,
        connectionId: connection.id,
        externalSubscriptionId: `sub_erase_${paid.communityId.slice(-8)}`,
        externalCustomerId: "cus_erase",
        email: (await emailOf(paid.buyerId)).toUpperCase(),
        interval: "month",
        status: "invited",
      })
      .returning();

    await harness.service.releaseBillingForUser(paid.communityId, paid.buyerId);

    const left = await admin.db
      .select({ email: subscriberMoves.email })
      .from(subscriberMoves)
      .where(eq(subscriberMoves.communityId, paid.communityId));
    expect(left.map((row) => row.email)).toEqual(["someone-else@example.test"]);
    const [forgotten] = await admin.db
      .select({ email: subscriptionLinks.email })
      .from(subscriptionLinks)
      .where(eq(subscriptionLinks.id, link?.id ?? ""));
    expect(forgotten?.email).toBe(`erased-${link?.id}@erased.invalid`);
  });

  it("removes rows 90 days after the free time ends or the member moved, and undated rows after 120 days", async () => {
    const { harness, paid } = await setup();
    const at = (days: number) => daysFrom(harness, days);
    const row = (email: string, fields: Partial<typeof subscriberMoves.$inferInsert>) => ({
      communityId: paid.communityId,
      email,
      source: "manual" as const,
      createdAt: at(-200),
      ...fields,
    });
    await admin.db.insert(subscriberMoves).values([
      row("ended-91@example.test", { freeUntil: at(-91) }),
      row("ended-89@example.test", { freeUntil: at(-89) }),
      row("moved-91@example.test", {
        freeUntil: at(-10),
        status: "resubscribed",
        resubscribedAt: at(-91),
      }),
      row("moved-89@example.test", { status: "resubscribed", resubscribedAt: at(-89) }),
      row("undated-121@example.test", { createdAt: at(-121) }),
      row("undated-119@example.test", { createdAt: at(-119) }),
    ]);

    const result = await harness.service.sweepSubscriberMoves();

    expect(result).toEqual({ removed: 3 });
    const left = await admin.db
      .select({ email: subscriberMoves.email })
      .from(subscriberMoves)
      .where(eq(subscriberMoves.communityId, paid.communityId));
    expect(left.map((entry) => entry.email).sort()).toEqual([
      "ended-89@example.test",
      "moved-89@example.test",
      "undated-119@example.test",
    ]);
  });
});

describe("free memberships of moving members on the Community Edition", () => {
  it("end at the free time date and stay open for rows with no date", async () => {
    const { paid } = await setup();
    const harness = createHarness(probe.db, communityEnv());
    const undatedId = await insertMember(admin.db, paid.communityId, "member");

    await addMove(harness, paid, paid.memberId, daysFrom(harness, 20));
    await addMove(harness, paid, undatedId, null);

    const comps = await admin.db
      .select({ userId: compedMemberships.userId, expiresAt: compedMemberships.expiresAt })
      .from(compedMemberships)
      .where(eq(compedMemberships.communityId, paid.communityId));
    expect(comps).toEqual([{ userId: paid.memberId, expiresAt: daysFrom(harness, 20) }]);
  });

  it("follow a new date on a later paste, but never end sooner than a week from now", async () => {
    const { paid } = await setup();
    const harness = createHarness(probe.db, communityEnv());
    const compEnd = async () => {
      const rows = await admin.db
        .select({ expiresAt: compedMemberships.expiresAt })
        .from(compedMemberships)
        .where(eq(compedMemberships.communityId, paid.communityId));
      return rows.map((row) => row.expiresAt);
    };

    await addMove(harness, paid, paid.memberId, daysFrom(harness, 14));
    await addMove(harness, paid, paid.memberId, daysFrom(harness, 74));
    const later = await compEnd();
    await addMove(harness, paid, paid.memberId, daysFrom(harness, 2));
    const earlier = await compEnd();

    expect(later).toEqual([daysFrom(harness, 74)]);
    expect(earlier).toEqual([daysFrom(harness, 7)]);
  });

  it("are left open on Cloud", async () => {
    const { harness, paid } = await setup();

    await addMove(harness, paid, paid.memberId, daysFrom(harness, 20));

    const comps = await admin.db
      .select({ id: compedMemberships.id })
      .from(compedMemberships)
      .where(eq(compedMemberships.communityId, paid.communityId));
    expect(comps).toEqual([]);
  });
});

describe("tracking a move", () => {
  it("marks the member moved as soon as any subscription for them is recorded", async () => {
    const { harness, paid } = await setup();
    await addMove(harness, paid, paid.buyerId, daysFrom(harness, 20));
    const subscription = stripeSubscription(paid, paid.buyerId, { status: "incomplete" });
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const event = signedEvent(
      "customer.subscription.created",
      { id: subscription.id, object: "subscription" },
      { account: paid.accountId },
    );

    await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery({
        rawBody: event.rawBody,
        signature: event.signature,
      }),
    );

    const [row] = await harness.service.listSubscriberMoves(user(paid.ownerId), paid.communityId);
    expect(row?.state).toBe("moved");
  });
});
