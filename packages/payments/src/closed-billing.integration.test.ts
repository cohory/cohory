import { getMembership, withCommunity, type CommunityId, type Database } from "@cohory/db";
import { paymentConnections, subscriptions, users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentsRepository } from "./repository";
import { insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
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

const closedAt = new Date("2026-01-10T00:00:00.000Z");
const ended = new Date("2026-01-20T00:00:00.000Z");
const running = new Date("2026-03-01T00:00:00.000Z");
const sweepAt = new Date("2026-02-01T00:00:00.000Z");

async function close(paid: PaidCommunity): Promise<void> {
  await admin.db
    .update(paymentConnections)
    .set({ status: "disconnected", disconnectedAt: closedAt })
    .where(eq(paymentConnections.communityId, paid.communityId));
}

async function payingMember(
  paid: PaidCommunity,
  periodEnd: Date,
  role: "member" | "admin" = "member",
) {
  const userId = await insertMember(admin.db, paid.communityId, role);
  const row = await mirrorSubscription(admin.db, paid.communityId, {
    userId,
    currentPeriodEnd: periodEnd,
  });
  return { userId, subscriptionId: row.id };
}

async function statusOf(communityId: CommunityId, userId: string) {
  return (await getMembership(withCommunity(admin.db, communityId), userId))?.status ?? null;
}

async function accessStateOf(subscriptionId: string) {
  const [row] = await admin.db
    .select({ accessState: subscriptions.accessState })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId));
  return row?.accessState ?? null;
}

function recordingSweepRows() {
  const listed: string[] = [];
  const wrapRepo = (repo: PaymentsRepository): PaymentsRepository => ({
    ...repo,
    async listClosedBillingDue(now, limit) {
      const due = await repo.listClosedBillingDue(now, limit);
      listed.push(...due.map((row) => row.subscriptionId));
      return due;
    },
  });
  return { listed, wrapRepo };
}

async function paidCommunity(harness: Harness) {
  return setupPaidCommunity(admin.db, harness, "private");
}

describe("ending paid access after a creator disconnected", () => {
  it("removes memberships whose closed billing ended and leaves the others", async () => {
    const sweep = recordingSweepRows();
    const harness = createHarness(probe.db, undefined, null, { wrapRepo: sweep.wrapRepo });
    const paid = await paidCommunity(harness);
    const other = await paidCommunity(harness);
    const due = await payingMember(paid, ended);
    const notYet = await payingMember(paid, running);
    const comped = await payingMember(paid, ended);
    const staff = await payingMember(paid, ended, "admin");
    const elsewhere = await payingMember(other, ended);
    await harness.service.grantComp(user(paid.ownerId), paid.communityId, {
      userId: comped.userId,
    });
    await close(paid);
    await close(other);
    harness.clock.now = sweepAt;

    const result = await harness.service.endClosedBillingAccess();

    const ours = new Set(
      [due, notYet, comped, staff, elsewhere].map((member) => member.subscriptionId),
    );
    const sweptOurs = () => sweep.listed.filter((id) => ours.has(id)).sort();
    expect(result.ended).toBeGreaterThanOrEqual(4);
    expect(sweptOurs()).toEqual(
      [due, comped, staff, elsewhere].map((member) => member.subscriptionId).sort(),
    );
    expect(await statusOf(paid.communityId, due.userId)).toBe("removed");
    expect(await accessStateOf(due.subscriptionId)).toBe("revoked");
    expect(await statusOf(paid.communityId, notYet.userId)).toBe("active");
    expect(await accessStateOf(notYet.subscriptionId)).toBe("granted");
    expect(await statusOf(paid.communityId, comped.userId)).toBe("active");
    expect(await accessStateOf(comped.subscriptionId)).toBe("revoked");
    expect(await statusOf(paid.communityId, staff.userId)).toBe("active");
    expect(await statusOf(other.communityId, elsewhere.userId)).toBe("removed");

    expect(await harness.service.getMembershipAccess(paid.communityId, due.userId)).toEqual({
      level: "payment_required",
      reason: "billing_closed",
    });
    expect((await harness.service.getMembershipAccess(paid.communityId, notYet.userId)).level).toBe(
      "member",
    );
    expect(
      await harness.service.getMembershipAccess(paid.communityId, comped.userId),
    ).toMatchObject({ level: "member", source: "comp" });

    sweep.listed.length = 0;
    await harness.service.endClosedBillingAccess();
    expect(sweptOurs()).toEqual([]);
  });

  it("resolves billing_closed before the sweep runs", async () => {
    const harness = createHarness(probe.db);
    const paid = await paidCommunity(harness);
    const due = await payingMember(paid, ended);
    await close(paid);
    harness.clock.now = sweepAt;

    expect(await harness.service.getMembershipAccess(paid.communityId, due.userId)).toEqual({
      level: "payment_required",
      reason: "billing_closed",
    });
    expect(await harness.service.hasActiveMembership(paid.communityId, due.userId)).toBe(false);
    const mine = await harness.service.getMyMembership(user(due.userId), paid.communityId);
    expect(mine.access).toEqual({ level: "payment_required", reason: "billing_closed" });
    expect(mine.supportContact).toMatch(/@example\.test$/);
    const [owner] = await admin.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, paid.ownerId));
    expect(mine.supportContact).toBe(owner?.email);
  });

  it("does not hand out the owner's email while paid access continues", async () => {
    const harness = createHarness(probe.db);
    const paid = await paidCommunity(harness);
    const member = await payingMember(paid, running);

    const mine = await harness.service.getMyMembership(user(member.userId), paid.communityId);

    expect(mine.supportContact).toBeNull();
  });

  it("keeps paid access while the connection is only disconnecting", async () => {
    const harness = createHarness(probe.db);
    const paid = await paidCommunity(harness);
    const member = await payingMember(paid, ended);
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnecting" })
      .where(eq(paymentConnections.communityId, paid.communityId));
    harness.clock.now = sweepAt;

    expect((await harness.service.getMembershipAccess(paid.communityId, member.userId)).level).toBe(
      "member",
    );
  });
});
