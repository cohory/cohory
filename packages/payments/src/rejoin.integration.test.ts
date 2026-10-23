import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import {
  getMembership,
  leaveMembership,
  setMemberRemovalReason,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { communities, memberships, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityArchivedCheckoutError } from "./errors";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { cloudEnv, insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type Harness,
  type MirroredSubscriptionInput,
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

const beforePeriodEnd = new Date("2026-11-18T10:00:00.000Z");
const afterPeriodEnd = new Date("2026-10-01T10:00:00.000Z");

interface Setup {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly payerId: string;
}

async function payingMember(
  privacy: "public" | "private" = "public",
  subscription: MirroredSubscriptionInput = {},
): Promise<Setup> {
  const harness = createHarness(probe.db, cloudEnv());
  const paid = await setupPaidCommunity(admin.db, harness, privacy);
  const payerId = await insertMember(admin.db, paid.communityId, "member");
  await mirrorSubscription(admin.db, paid.communityId, {
    userId: payerId,
    planId: paid.planId,
    ...subscription,
  });
  return { harness, paid, payerId };
}

async function leave(communityId: CommunityId, userId: string): Promise<void> {
  await leaveMembership(withCommunity(admin.db, communityId), userId);
}

async function removeByStaff(communityId: CommunityId, userId: string): Promise<void> {
  await admin.db.transaction(async (tx) => {
    await setMemberRemovalReason(tx, "removed");
    await tx
      .update(memberships)
      .set({ status: "removed" })
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)));
  });
}

async function statusOf(communityId: CommunityId, userId: string): Promise<string | null> {
  return (await getMembership(withCommunity(admin.db, communityId), userId))?.status ?? null;
}

describe("joining again with paid access after leaving", () => {
  it("restores the membership of a member who left while their subscription is active", async () => {
    const { harness, paid, payerId } = await payingMember();
    await leave(paid.communityId, payerId);

    const result = await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId);

    expect(result).toEqual({ restored: true });
    expect(await statusOf(paid.communityId, payerId)).toBe("active");
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
  });

  it("restores a moderator who left as a plain member", async () => {
    const { harness, paid, payerId } = await payingMember();
    await admin.db
      .update(memberships)
      .set({ role: "moderator" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, payerId)));
    await leave(paid.communityId, payerId);

    await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId);

    expect(await getMembership(withCommunity(admin.db, paid.communityId), payerId)).toMatchObject({
      status: "active",
      role: "member",
    });
  });

  it("activates a paying admin who left as a plain member", async () => {
    const { paid, payerId } = await payingMember();
    await admin.db
      .update(memberships)
      .set({ role: "admin" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, payerId)));
    await leave(paid.communityId, payerId);

    await createPostgresPaymentsRepository(probe.db).activateMembership(
      paid.communityId,
      payerId,
      new Date(),
    );

    expect(await getMembership(withCommunity(admin.db, paid.communityId), payerId)).toMatchObject({
      status: "active",
      role: "member",
    });
  });

  it("restores a member whose subscription is set to cancel at the period end", async () => {
    const { harness, paid, payerId } = await payingMember("public", {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: beforePeriodEnd,
    });
    await leave(paid.communityId, payerId);

    expect(await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId)).toEqual({
      restored: true,
    });
  });

  it("restores a member whose payment is past due", async () => {
    const { harness, paid, payerId } = await payingMember("public", {
      providerStatus: "past_due",
      accessState: "grace",
    });
    await leave(paid.communityId, payerId);

    expect(await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId)).toEqual({
      restored: true,
    });
  });

  it("restores a member who left a private community", async () => {
    const { harness, paid, payerId } = await payingMember("private");
    await leave(paid.communityId, payerId);

    expect(await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId)).toEqual({
      restored: true,
    });
    expect(await statusOf(paid.communityId, payerId)).toBe("active");
  });

  it("sends a member whose paid period ended to checkout", async () => {
    const { harness, paid, payerId } = await payingMember("public", {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: afterPeriodEnd,
    });
    await leave(paid.communityId, payerId);

    const result = await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId);
    const checkout = await harness.service.createCheckoutSession(user(payerId), paid.communityId);

    expect(result).toEqual({ restored: false });
    expect(await statusOf(paid.communityId, payerId)).toBe("removed");
    expect(checkout.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });

  it("does not restore a member staff removed, even with an active subscription", async () => {
    const { harness, paid, payerId } = await payingMember();
    await removeByStaff(paid.communityId, payerId);

    const result = await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId);

    expect(result).toEqual({ restored: false });
    expect(await statusOf(paid.communityId, payerId)).toBe("removed");
  });

  it("does not restore a removal recorded before reasons were stored", async () => {
    const { harness, paid } = await payingMember();
    const legacyId = await insertMember(admin.db, paid.communityId, "member", "removed");
    await mirrorSubscription(admin.db, paid.communityId, { userId: legacyId });

    expect(await harness.service.rejoinWithPaidAccess(user(legacyId), paid.communityId)).toEqual({
      restored: false,
    });
  });

  it("refuses a banned member", async () => {
    const { harness, paid, payerId } = await payingMember();
    await leave(paid.communityId, payerId);
    await admin.db
      .update(memberships)
      .set({ status: "banned" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, payerId)));

    await expect(
      harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(paid.communityId, payerId)).toBe("banned");
  });

  it("refuses a member whose address is banned in the community", async () => {
    const { harness, paid, payerId } = await payingMember();
    const formerId = await insertMember(admin.db, paid.communityId, "member", "banned");
    const [payer] = await admin.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, payerId));
    await admin.db
      .update(memberships)
      .set({ bannedEmail: payer?.email ?? "" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, formerId)));
    await leave(paid.communityId, payerId);

    await expect(
      harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(paid.communityId, payerId)).toBe("removed");
  });

  it("refuses while the community is archived", async () => {
    const { harness, paid, payerId } = await payingMember();
    await leave(paid.communityId, payerId);
    await admin.db
      .update(communities)
      .set({ archivedAt: new Date("2026-10-17T10:00:00.000Z") })
      .where(eq(communities.id, paid.communityId));

    await expect(
      harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId),
    ).rejects.toBeInstanceOf(CommunityArchivedCheckoutError);
    expect(await statusOf(paid.communityId, payerId)).toBe("removed");
  });

  it("refuses a guest", async () => {
    const { harness, paid } = await payingMember();

    await expect(
      harness.service.rejoinWithPaidAccess({ kind: "guest" }, paid.communityId),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("does not use a subscription in one community to rejoin another", async () => {
    const first = await payingMember();
    const other = await payingMember();
    const payerId = first.payerId;
    await admin.db.insert(memberships).values({
      communityId: other.paid.communityId,
      userId: payerId,
      role: "member",
      status: "active",
    });
    await leave(first.paid.communityId, payerId);
    await leave(other.paid.communityId, payerId);

    const crossed = await other.harness.service.rejoinWithPaidAccess(
      user(payerId),
      other.paid.communityId,
    );
    const stranger = await first.harness.service.rejoinWithPaidAccess(
      user(other.payerId),
      first.paid.communityId,
    );

    expect(crossed).toEqual({ restored: false });
    expect(stranger).toEqual({ restored: false });
    expect(await statusOf(other.paid.communityId, payerId)).toBe("removed");
    expect(await statusOf(first.paid.communityId, payerId)).toBe("removed");
    expect(await statusOf(first.paid.communityId, other.payerId)).toBeNull();
  });

  it("leaves an active member as they are", async () => {
    const { harness, paid, payerId } = await payingMember();

    expect(await harness.service.rejoinWithPaidAccess(user(payerId), paid.communityId)).toEqual({
      restored: false,
    });
    expect(await statusOf(paid.communityId, payerId)).toBe("active");
  });
});

describe("the membership view for a member who left", () => {
  it("offers joining again while paid access lasts", async () => {
    const { harness, paid, payerId } = await payingMember();
    await leave(paid.communityId, payerId);

    const view = await harness.service.getMyMembership(user(payerId), paid.communityId);

    expect(view.canRejoin).toBe(true);
  });

  it("does not offer it to a member staff removed or to an active member", async () => {
    const removed = await payingMember();
    await removeByStaff(removed.paid.communityId, removed.payerId);
    const active = await payingMember();

    const removedView = await removed.harness.service.getMyMembership(
      user(removed.payerId),
      removed.paid.communityId,
    );
    const activeView = await active.harness.service.getMyMembership(
      user(active.payerId),
      active.paid.communityId,
    );

    expect(removedView.canRejoin).toBe(false);
    expect(activeView.canRejoin).toBe(false);
  });
});
