import { UnauthenticatedError, type Actor } from "@cohory/authz";
import type { CommunityId, Database } from "@cohory/db";
import { communities, paymentConnections, subscriptions, users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAccountBilling } from "./account";
import {
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
let clock = new Date("2026-10-18T10:00:00.000Z");
const periodEnd = new Date("2026-11-18T10:00:00.000Z");
const closedAt = new Date("2026-10-19T10:00:00.000Z");

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

function billing() {
  return createAccountBilling({ db: probe.db, now: () => clock });
}

async function paidCommunity(): Promise<PaidCommunity> {
  return setupPaidCommunity(admin.db, createHarness(probe.db), "private");
}

async function closeConnection(communityId: CommunityId): Promise<void> {
  await admin.db
    .update(paymentConnections)
    .set({ status: "disconnected", disconnectedAt: closedAt })
    .where(eq(paymentConnections.communityId, communityId));
}

async function archive(communityId: CommunityId): Promise<void> {
  await admin.db
    .update(communities)
    .set({ archivedAt: closedAt })
    .where(eq(communities.id, communityId));
}

async function subscribe(paid: PaidCommunity, userId: string, overrides = {}) {
  return mirrorSubscription(admin.db, paid.communityId, {
    userId,
    planId: paid.planId,
    currentPeriodEnd: periodEnd,
    ...overrides,
  });
}

async function emailOf(userId: string): Promise<string | undefined> {
  const [row] = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email;
}

describe("communities that keep an owner's account from being deleted", () => {
  it("names an archived community that still has paying members", async () => {
    const paid = await paidCommunity();
    await subscribe(paid, paid.memberId);
    await closeConnection(paid.communityId);
    await archive(paid.communityId);

    expect(await billing().paidCommunityBlockers([paid.communityId])).toEqual(
      new Set([paid.communityId]),
    );
  });

  it("names an archived community with an open Stripe connection", async () => {
    const paid = await paidCommunity();
    await archive(paid.communityId);

    expect(await billing().paidCommunityBlockers([paid.communityId])).toEqual(
      new Set([paid.communityId]),
    );
  });

  it("leaves out communities with nothing billing", async () => {
    const closed = await paidCommunity();
    await subscribe(closed, closed.memberId, {
      providerStatus: "canceled",
      accessState: "revoked",
    });
    await closeConnection(closed.communityId);
    const free = await insertCommunity(admin.db);

    expect(await billing().paidCommunityBlockers([closed.communityId, free])).toEqual(new Set());
    expect(await billing().paidCommunityBlockers([])).toEqual(new Set());
  });
});

describe("the paid memberships on Account, Billing", () => {
  it("lists the viewer's paid memberships across communities and nobody else's", async () => {
    const first = await paidCommunity();
    const second = await paidCommunity();
    const third = await paidCommunity();
    const viewer = await insertUser(admin.db, "Viewer");
    const neighbour = await insertUser(admin.db, "Neighbour");
    await subscribe(first, viewer);
    await subscribe(second, viewer);
    await subscribe(first, neighbour);
    await subscribe(third, neighbour);
    await subscribe(third, third.memberId);

    const rows = await billing().listMyPaidMemberships(user(viewer));

    expect(rows.map((row) => row.communityId).sort()).toEqual(
      [first.communityId, second.communityId].sort(),
    );
    const theirs = await billing().listMyPaidMemberships(user(neighbour));
    expect(theirs.map((row) => row.communityId).sort()).toEqual(
      [first.communityId, third.communityId].sort(),
    );
    expect(await billing().listMyPaidMemberships(user(await insertUser(admin.db)))).toEqual([]);
  });

  it("refuses a guest", async () => {
    const guest: Actor = { kind: "guest" };

    await expect(billing().listMyPaidMemberships(guest)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("shows Manage billing while the connection is open", async () => {
    const paid = await paidCommunity();
    const viewer = await insertMember(admin.db, paid.communityId);
    await subscribe(paid, viewer);

    const [row] = await billing().listMyPaidMemberships(user(viewer));

    expect(row).toMatchObject({
      communityId: paid.communityId,
      amountMinor: 4900,
      currency: "usd",
      interval: "month",
      providerStatus: "active",
      nextChargeAt: periodEnd,
      endsAt: null,
      billing: { kind: "portal" },
    });
    expect(row?.planName).toEqual(expect.any(String));
    expect(row?.communityName).toBe("Paid circle");
  });

  it("still lists Manage billing for a member removed from a private community whose subscription bills", async () => {
    const paid = await paidCommunity();
    const removed = await insertMember(admin.db, paid.communityId, "member", "removed");
    await subscribe(paid, removed);

    const [row] = await billing().listMyPaidMemberships(user(removed));

    expect(row).toMatchObject({
      communityId: paid.communityId,
      providerStatus: "active",
      billing: { kind: "portal" },
    });
  });

  it("shows billed directly with the owner's email after disconnect until the period ends", async () => {
    const paid = await paidCommunity();
    const viewer = await insertMember(admin.db, paid.communityId);
    await subscribe(paid, viewer);
    await closeConnection(paid.communityId);

    const [row] = await billing().listMyPaidMemberships(user(viewer));

    expect(row).toMatchObject({
      nextChargeAt: null,
      endsAt: periodEnd,
      billing: { kind: "direct", supportContact: await emailOf(paid.ownerId) },
    });
    clock = new Date(periodEnd.getTime() + 1000);
    try {
      expect(await billing().listMyPaidMemberships(user(viewer))).toEqual([]);
    } finally {
      clock = new Date("2026-10-18T10:00:00.000Z");
    }
  });

  it("names the owner who accepted the connection as the support contact", async () => {
    const paid = await paidCommunity();
    const viewer = await insertMember(admin.db, paid.communityId);
    await subscribe(paid, viewer);
    await admin.db
      .update(paymentConnections)
      .set({ acceptedOwnerId: paid.adminId })
      .where(eq(paymentConnections.communityId, paid.communityId));
    await closeConnection(paid.communityId);

    const [row] = await billing().listMyPaidMemberships(user(viewer));

    expect(row?.billing).toEqual({ kind: "direct", supportContact: await emailOf(paid.adminId) });
  });

  it("keeps an archived community listed until the subscription ends", async () => {
    const paid = await paidCommunity();
    const viewer = await insertMember(admin.db, paid.communityId);
    const row = await subscribe(paid, viewer, { cancelAtPeriodEnd: true });
    await archive(paid.communityId);

    const [listed] = await billing().listMyPaidMemberships(user(viewer));
    expect(listed).toMatchObject({
      communityId: paid.communityId,
      nextChargeAt: null,
      endsAt: periodEnd,
      billing: { kind: "portal" },
    });

    await admin.db
      .update(subscriptions)
      .set({ providerStatus: "canceled", accessState: "revoked", endedAt: periodEnd })
      .where(eq(subscriptions.id, row.id));
    expect(await billing().listMyPaidMemberships(user(viewer))).toEqual([]);
  });
});
