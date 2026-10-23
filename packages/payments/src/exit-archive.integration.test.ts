import type { CommunityId, Database } from "@cohory/db";
import { communities, outbox } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityArchivedCheckoutError } from "./errors";
import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import { cloudEnv, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type Harness,
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

async function archivedPaidCommunity() {
  const harness = createHarness(probe.db, cloudEnv());
  const paid = await setupPaidCommunity(admin.db, harness);
  return { harness, paid };
}

async function markArchived(communityId: CommunityId): Promise<void> {
  await admin.db
    .update(communities)
    .set({ archivedAt: new Date("2026-10-19T10:00:00Z") })
    .where(eq(communities.id, communityId));
}

async function payingMember(harness: Harness, communityId: CommunityId, userId?: string) {
  const row = await mirrorSubscription(admin.db, communityId, userId ? { userId } : {});
  harness.gateway.subscriptions.set(row.externalSubscriptionId, {
    id: row.externalSubscriptionId,
    status: "active",
    customerId: `cus_${row.id}`,
    metadata: {},
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    endedAt: null,
    interval: "month",
    applicationFeePercent: 2,
    priceId: null,
  });
  return row;
}

async function eventsOf(communityId: CommunityId): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, paidMembershipEventsTopic)));
  return rows.flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events);
}

describe("archived communities and paid members", () => {
  it("refuses a checkout in an archived community with community_archived", async () => {
    const { harness, paid } = await archivedPaidCommunity();
    await markArchived(paid.communityId);

    const checkout = harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    await expect(checkout).rejects.toBeInstanceOf(CommunityArchivedCheckoutError);
    await expect(checkout).rejects.toMatchObject({ code: "community_archived" });
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
    const membership = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(membership.communityArchived).toBe(true);
    expect(membership.plan?.purchasable).toBe(false);
  });

  it("refuses a plan change in an archived community", async () => {
    const { harness, paid } = await archivedPaidCommunity();
    await markArchived(paid.communityId);

    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "USD",
        monthlyPriceMinor: 5900,
        annualPriceMinor: null,
      }),
    ).rejects.toMatchObject({ code: "community_archived" });
  });

  it("still opens the customer portal in an archived community", async () => {
    const { harness, paid } = await archivedPaidCommunity();
    const subscription = await payingMember(harness, paid.communityId, paid.memberId);
    await markArchived(paid.communityId);

    const portal = await harness.service.createPortalSession(user(paid.memberId), paid.communityId);

    expect(portal.url).toContain(`cus_mirror`);
    expect(subscription.userId).toBe(paid.memberId);
  });

  it("archives with stop at period end and tells each member the end date", async () => {
    const { harness, paid } = await archivedPaidCommunity();
    const first = await payingMember(harness, paid.communityId);
    const second = await payingMember(harness, paid.communityId);

    const run = await harness.service.beginArchive({
      communityId: paid.communityId,
      actorId: paid.ownerId,
      choice: "stop_at_period_end",
      includeLinked: true,
    });

    expect(run).toMatchObject({ kind: "archive", choice: "stop_at_period_end", status: "done" });
    expect(harness.gateway.writes("scheduleCancellation")).toHaveLength(2);
    const events = await eventsOf(paid.communityId);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type === "paid_membership.changed" && event.payload).toMatchObject({
      noticeId: run?.id,
      actorId: paid.ownerId,
      change: "archived_ending",
      recipients: expect.arrayContaining([
        { userId: first.userId, endsAt: "2026-11-18T10:00:00.000Z" },
        { userId: second.userId, endsAt: "2026-11-18T10:00:00.000Z" },
      ]),
    });
  });

  it("archives with keep billing, calls Stripe never, and tells members it continues", async () => {
    const { harness, paid } = await archivedPaidCommunity();
    const member = await payingMember(harness, paid.communityId);
    const callsBefore = harness.gateway.calls.length;

    const run = await harness.service.beginArchive({
      communityId: paid.communityId,
      actorId: paid.ownerId,
      choice: "keep_billing",
      includeLinked: true,
    });

    expect(run).toMatchObject({ choice: "keep_billing", status: "done", doneCount: 1 });
    expect(harness.gateway.calls.length).toBe(callsBefore);
    const [event] = await eventsOf(paid.communityId);
    expect(event?.type === "paid_membership.changed" && event.payload).toMatchObject({
      change: "archived_continuing",
      recipients: [{ userId: member.userId, endsAt: null }],
    });
  });

  it("starts no run when nobody pays", async () => {
    const { harness, paid } = await archivedPaidCommunity();

    expect(
      await harness.service.beginArchive({
        communityId: paid.communityId,
        actorId: paid.ownerId,
        choice: "stop_at_period_end",
        includeLinked: true,
      }),
    ).toBeNull();
    expect(await eventsOf(paid.communityId)).toEqual([]);
  });
});
