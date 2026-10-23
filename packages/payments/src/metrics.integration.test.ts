import { ForbiddenError } from "@cohory/authz";
import { newId, type CommunityId } from "@cohory/db";
import { membershipPlans, memberships, payments, subscriptions } from "@cohory/db/schema";
import type { SubscriptionAccessState } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countActivatedSubscriptions } from "./counts";
import type { RevenueMetrics } from "./service/metrics";
import { openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type Harness,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: Awaited<ReturnType<typeof openProbeDb>>;
let harness: Harness;
let paid: PaidCommunity;

interface SeededSubscription {
  readonly userId?: string;
  readonly accessState: SubscriptionAccessState;
  readonly createdAt: string;
  readonly endedAt?: string;
  readonly interval?: "month" | "year";
  readonly cancelAtPeriodEnd?: boolean;
  readonly origin?: "created_by_cohory" | "linked_import";
  readonly payment?: {
    readonly amountMinor: number;
    readonly refundedMinor?: number;
    readonly at: string;
  };
}

async function seed(communityId: CommunityId, planId: string, input: SeededSubscription) {
  const row = await mirrorSubscription(admin.db, communityId, {
    planId,
    accessState: input.accessState,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    origin: input.origin ?? "created_by_cohory",
    ...(input.userId ? { userId: input.userId } : {}),
  });
  await admin.db
    .update(subscriptions)
    .set({
      createdAt: new Date(input.createdAt),
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
      interval: input.interval ?? "month",
    })
    .where(eq(subscriptions.id, row.id));
  if (input.payment) {
    await admin.db.insert(payments).values({
      communityId,
      subscriptionId: row.id,
      externalInvoiceId: `in_metrics${newId()}`,
      currency: "usd",
      amountMinor: input.payment.amountMinor,
      refundedMinor: input.payment.refundedMinor ?? 0,
      occurredAt: new Date(input.payment.at),
    });
  }
}

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
  harness = createHarness(probe.db);
  harness.clock.now = new Date("2026-10-18T10:00:00.000Z");
  paid = await setupPaidCommunity(admin.db, harness);
  await admin.db
    .update(memberships)
    .set({
      joinedAt: new Date("2026-06-01T00:00:00Z"),
      lastSeenAt: new Date("2026-09-01T00:00:00Z"),
    })
    .where(
      and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, paid.memberId)),
    );
  const rows: SeededSubscription[] = [
    {
      userId: paid.memberId,
      accessState: "granted",
      createdAt: "2026-09-10T00:00:00Z",
      payment: { amountMinor: 4900, at: "2026-10-10T00:00:00Z" },
    },
    { accessState: "grace", createdAt: "2026-10-05T00:00:00Z" },
    {
      accessState: "granted",
      createdAt: "2026-08-01T00:00:00Z",
      interval: "year",
      cancelAtPeriodEnd: true,
      payment: { amountMinor: 49_000, at: "2026-08-01T00:00:00Z" },
    },
    {
      accessState: "revoked",
      createdAt: "2026-07-01T00:00:00Z",
      endedAt: "2026-10-03T00:00:00Z",
      payment: { amountMinor: 4900, refundedMinor: 900, at: "2026-09-15T00:00:00Z" },
    },
    { accessState: "revoked", createdAt: "2026-06-01T00:00:00Z", endedAt: "2026-09-20T00:00:00Z" },
    { accessState: "none", createdAt: "2026-10-12T00:00:00Z" },
    { accessState: "granted", createdAt: "2026-10-02T00:00:00Z", origin: "linked_import" },
  ];
  for (const row of rows) {
    await seed(paid.communityId, paid.planId, row);
  }
  const other = await setupPaidCommunity(admin.db, harness);
  await seed(other.communityId, other.planId, {
    accessState: "grace",
    createdAt: "2026-10-06T00:00:00Z",
    payment: { amountMinor: 4900, at: "2026-10-07T00:00:00Z" },
  });
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("revenue metrics", () => {
  let metrics: RevenueMetrics;

  beforeAll(async () => {
    metrics = await harness.service.getRevenueMetrics(user(paid.ownerId), paid.communityId);
  });

  it("counts paying members, past due and cancel at period end from the subscription mirror", () => {
    expect(metrics.currency).toBe("usd");
    expect(metrics.payingCount).toBe(4);
    expect(metrics.pastDueCount).toBe(1);
    expect(metrics.cancellingCount).toBe(1);
    expect(metrics.everPaid).toBe(true);
  });

  it("normalizes yearly plans to a monthly amount and compares with the start of the month", () => {
    expect(metrics.mrrMinor).toEqual({ current: 4900 * 3 + 4083, previous: 4900 * 2 + 4083 });
  });

  it("sums revenue net of refunds per calendar month", () => {
    expect(metrics.revenueMinor).toEqual({ current: 4900, previous: 4000 });
  });

  it("counts new paid members without linked imports or unfinished checkouts", () => {
    expect(metrics.newPaid).toEqual({ current: 1, previous: 1 });
  });

  it("counts ended subscriptions as cancellations in the month they ended", () => {
    expect(metrics.cancellations).toEqual({ current: 1, previous: 1 });
  });

  it("counts paying members who have not been active for 14 days", () => {
    expect(metrics.payingInactiveCount).toBe(1);
  });

  it("lets an admin read the numbers", async () => {
    const view = await harness.service.getRevenueMetrics(user(paid.adminId), paid.communityId);
    expect(view.payingCount).toBe(4);
  });

  it("refuses a member", async () => {
    await expect(
      harness.service.getRevenueMetrics(user(paid.memberId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("counting activated subscriptions", () => {
  it("counts every subscription that ever gave access, without unfinished checkouts or other communities", async () => {
    expect(await countActivatedSubscriptions(probe.db, paid.communityId)).toBe(6);
    const fresh = await setupPaidCommunity(admin.db, harness);
    expect(await countActivatedSubscriptions(probe.db, fresh.communityId)).toBe(0);
  });
});

describe("revenue metrics for a new paid community", () => {
  it("is all zero before anyone buys", async () => {
    const fresh = await setupPaidCommunity(admin.db, harness);
    const metrics = await harness.service.getRevenueMetrics(user(fresh.ownerId), fresh.communityId);
    expect(metrics.payingCount).toBe(0);
    expect(metrics.everPaid).toBe(false);
    expect(metrics.mrrMinor).toEqual({ current: 0, previous: 0 });
    expect(metrics.revenueMinor).toEqual({ current: 0, previous: 0 });
  });
  it("keeps the currency of the plan that was sold when a draft in another currency exists", async () => {
    const fresh = await setupPaidCommunity(admin.db, harness);
    await admin.db
      .update(membershipPlans)
      .set({ archivedAt: new Date("2026-10-10T10:00:00.000Z") })
      .where(eq(membershipPlans.id, fresh.planId));
    await admin.db.insert(membershipPlans).values({
      communityId: fresh.communityId,
      connectionId: null,
      name: "Membership",
      currency: "eur",
      monthlyPriceMinor: 2000,
      annualPriceMinor: null,
    });

    const metrics = await harness.service.getRevenueMetrics(user(fresh.ownerId), fresh.communityId);

    expect(metrics.currency).toBe("usd");
  });
});
