import { ForbiddenError } from "@cohory/authz";
import { getMembership, setRlsValue, withCommunity, type Database } from "@cohory/db";
import {
  auditLog,
  compedMemberships,
  compInvitations,
  memberships,
  users,
} from "@cohory/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CompAlreadyGrantedError,
  PaymentsNotFoundError,
  PaymentsValidationError,
  PlanUnavailableError,
} from "./errors";
import {
  communityEnv,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import {
  createHarness,
  setupPaidCommunity,
  type Harness,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const dayMs = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function membershipStatus(paid: PaidCommunity, userId: string) {
  return (await getMembership(withCommunity(admin.db, paid.communityId), userId))?.status ?? null;
}

async function auditActions(paid: PaidCommunity): Promise<string[]> {
  const rows = await admin.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.communityId, paid.communityId))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((row) => row.action);
}

async function emailOf(userId: string): Promise<string> {
  const [row] = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email ?? "";
}

async function verifiedEmail(userId: string): Promise<string> {
  await admin.db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  return emailOf(userId);
}

async function leftMember(paid: PaidCommunity, reason: "left" | "removed"): Promise<string> {
  const id = await insertMember(admin.db, paid.communityId, "member");
  await admin.db.transaction(async (tx) => {
    await setRlsValue(tx, "member_removal_reason", reason);
    await tx
      .update(memberships)
      .set({ status: "removed" })
      .where(and(eq(memberships.communityId, paid.communityId), eq(memberships.userId, id)));
  });
  return id;
}

async function paidSetup(): Promise<{ harness: Harness; paid: PaidCommunity }> {
  const harness = createHarness(probe.db);
  return { harness, paid: await setupPaidCommunity(admin.db, harness) };
}

describe("comped access", () => {
  it("on the Cloud Edition invites by email and gives access only when the person accepts", async () => {
    const { harness, paid } = await paidSetup();
    const email = await verifiedEmail(paid.buyerId);

    const result = await harness.service.grantComp(user(paid.ownerId), paid.communityId, {
      email: email.toUpperCase(),
      note: "Speaker",
    });

    expect(result.kind).toBe("invited");
    if (result.kind !== "invited") throw new Error("expected an invitation");
    expect(result.invitation).toMatchObject({
      email: email.toUpperCase(),
      note: "Speaker",
      expiresAt: null,
    });
    expect(await membershipStatus(paid, paid.buyerId)).toBeNull();
    expect(
      await admin.db
        .select()
        .from(compedMemberships)
        .where(eq(compedMemberships.communityId, paid.communityId)),
    ).toEqual([]);
    expect(await harness.service.listComps(user(paid.adminId), paid.communityId)).toEqual([]);
    expect(
      await harness.service.listCompInvitations(user(paid.adminId), paid.communityId),
    ).toMatchObject([{ id: result.invitation.id, note: "Speaker", grantedByName: "Buyer" }]);

    const offers = await harness.service.listMyCompInvitations(
      user(paid.buyerId),
      paid.communityId,
    );
    expect(offers).toEqual({
      invitations: [{ id: result.invitation.id, expiresAt: null }],
      waitingForVerification: false,
    });
    const comp = await harness.service.acceptCompInvitation(
      user(paid.buyerId),
      paid.communityId,
      result.invitation.id,
    );

    expect(comp).toMatchObject({ userId: paid.buyerId, status: "active", note: "Speaker" });
    expect(await membershipStatus(paid, paid.buyerId)).toBe("active");
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.access).toEqual({ level: "member", source: "comp", expiresAt: null });
    expect(await auditActions(paid)).toEqual(["comp.invited", "comp.accepted"]);
    expect(await harness.service.listCompInvitations(user(paid.ownerId), paid.communityId)).toEqual(
      [],
    );
    await expect(
      harness.service.acceptCompInvitation(
        user(paid.buyerId),
        paid.communityId,
        result.invitation.id,
      ),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
  });

  it("on the Cloud Edition answers the same whether or not the address has an account", async () => {
    const { harness, paid } = await paidSetup();
    const known = await verifiedEmail(paid.buyerId);
    const owner = user(paid.ownerId);

    const shape = async (email: string) => {
      const result = await harness.service.grantComp(owner, paid.communityId, { email });
      if (result.kind !== "invited") throw new Error("expected an invitation");
      const { id, createdAt, email: sent, ...rest } = result.invitation;
      expect([typeof id, createdAt instanceof Date, sent]).toEqual(["string", true, email]);
      return { kind: result.kind, keys: Object.keys(result.invitation).sort(), rest };
    };

    expect(await shape(known)).toEqual(await shape(`nobody-${paid.communityId}@example.test`));
    expect(await membershipStatus(paid, paid.buyerId)).toBeNull();
  });

  it("on the Cloud Edition lets only the invited address accept, after confirming it", async () => {
    const { harness, paid } = await paidSetup();
    const email = await emailOf(paid.buyerId);
    const result = await harness.service.grantComp(user(paid.ownerId), paid.communityId, {
      email,
    });
    if (result.kind !== "invited") throw new Error("expected an invitation");

    expect(
      await harness.service.listMyCompInvitations(user(paid.buyerId), paid.communityId),
    ).toEqual({ invitations: [], waitingForVerification: true });
    await expect(
      harness.service.acceptCompInvitation(
        user(paid.buyerId),
        paid.communityId,
        result.invitation.id,
      ),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
    const stranger = await insertUser(admin.db);
    await verifiedEmail(stranger);
    await expect(
      harness.service.acceptCompInvitation(user(stranger), paid.communityId, result.invitation.id),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);

    await harness.service.withdrawCompInvitation(
      user(paid.adminId),
      paid.communityId,
      result.invitation.id,
    );
    await verifiedEmail(paid.buyerId);
    await expect(
      harness.service.acceptCompInvitation(
        user(paid.buyerId),
        paid.communityId,
        result.invitation.id,
      ),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
    expect(await membershipStatus(paid, paid.buyerId)).toBeNull();
    expect(await auditActions(paid)).toEqual(["comp.invited", "comp.invitation_withdrawn"]);
  });

  it("on the Cloud Edition grants by user id only to people in the community", async () => {
    const { harness, paid } = await paidSetup();
    const owner = user(paid.ownerId);
    const left = await leftMember(paid, "left");
    const removed = await leftMember(paid, "removed");

    await expect(
      harness.service.grantComp(owner, paid.communityId, { userId: paid.memberId }),
    ).resolves.toMatchObject({ kind: "granted", comp: { userId: paid.memberId } });
    await expect(
      harness.service.grantComp(owner, paid.communityId, { userId: left }),
    ).resolves.toMatchObject({ kind: "granted" });
    expect(await membershipStatus(paid, left)).toBe("active");
    for (const outsider of [paid.buyerId, removed, "0199f0a0-0000-7000-8000-00000000abcd"]) {
      await expect(
        harness.service.grantComp(owner, paid.communityId, { userId: outsider }),
      ).rejects.toBeInstanceOf(PaymentsNotFoundError);
    }
    expect(await membershipStatus(paid, paid.buyerId)).toBeNull();
  });

  it("on the Community Edition grants by email to an existing account at once", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "rk_test_owner123",
      webhookSecret: "whsec_owner123",
    });
    await harness.service.upsertPlan(user(ownerId), communityId, {
      currency: "USD",
      monthlyPriceMinor: 4900,
    });
    const personId = await insertUser(admin.db);

    const result = await harness.service.grantComp(user(ownerId), communityId, {
      email: await emailOf(personId),
    });

    expect(result).toMatchObject({ kind: "granted", comp: { userId: personId, status: "active" } });
    expect((await getMembership(withCommunity(admin.db, communityId), personId))?.status).toBe(
      "active",
    );
    await expect(
      harness.service.grantComp(user(ownerId), communityId, { email: "nobody@example.test" }),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
  });

  it("lets an admin grant to a member by id with an end date that the expiry job enforces", async () => {
    const { harness, paid } = await paidSetup();
    const expiresAt = new Date(harness.clock.now.getTime() + 7 * dayMs);

    await harness.service.grantComp(user(paid.adminId), paid.communityId, {
      userId: paid.memberId,
      expiresAt,
    });
    expect(await harness.service.expireComps()).toEqual({ expired: 0 });

    harness.clock.now = new Date(expiresAt.getTime() + 1000);
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.memberId)).toBe(true);
    expect(
      (await harness.service.getMyMembership(user(paid.memberId), paid.communityId)).access,
    ).toMatchObject({ level: "member", source: "membership" });

    const run = await harness.service.expireComps();

    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect(await membershipStatus(paid, paid.memberId)).toBe("removed");
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.memberId)).toBe(false);
    expect(await harness.service.listComps(user(paid.ownerId), paid.communityId)).toEqual([]);
    expect(await auditActions(paid)).toEqual(["comp.granted", "comp.expired"]);
  });

  it("removes the membership on revoke unless the person has other access", async () => {
    const { harness, paid } = await paidSetup();
    const comp = await granted(harness, paid, paid.memberId);
    const staffComp = await granted(harness, paid, paid.adminId);

    const revoked = await harness.service.revokeComp(user(paid.adminId), paid.communityId, comp.id);
    await harness.service.revokeComp(user(paid.ownerId), paid.communityId, staffComp.id);

    expect(revoked.status).toBe("revoked");
    expect(await membershipStatus(paid, paid.memberId)).toBe("removed");
    expect(await membershipStatus(paid, paid.adminId)).toBe("active");
    await expect(
      harness.service.revokeComp(user(paid.ownerId), paid.communityId, comp.id),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
  });

  it("refuses duplicates, banned people, past dates, and free communities", async () => {
    const { harness, paid } = await paidSetup();
    const owner = user(paid.ownerId);
    await granted(harness, paid, paid.memberId);

    await expect(
      harness.service.grantComp(owner, paid.communityId, { userId: paid.memberId }),
    ).rejects.toBeInstanceOf(CompAlreadyGrantedError);
    await expect(
      harness.service.grantComp(owner, paid.communityId, {
        userId: paid.adminId,
        expiresAt: new Date(harness.clock.now.getTime() - 1000),
      }),
    ).rejects.toBeInstanceOf(PaymentsValidationError);
    await expect(harness.service.grantComp(owner, paid.communityId, {})).rejects.toBeInstanceOf(
      PaymentsValidationError,
    );
    const banned = await insertMember(admin.db, paid.communityId, "member", "banned");
    await expect(
      harness.service.grantComp(owner, paid.communityId, { userId: banned }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const invited = await harness.service.grantComp(owner, paid.communityId, {
      email: await verifiedEmail(banned),
    });
    if (invited.kind !== "invited") throw new Error("expected an invitation");
    await expect(
      harness.service.acceptCompInvitation(user(banned), paid.communityId, invited.invitation.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const free = await insertCommunity(admin.db);
    const freeOwner = await insertMember(admin.db, free, "owner");
    await expect(
      harness.service.grantComp(user(freeOwner), free, {
        userId: await insertMember(admin.db, free, "member"),
      }),
    ).rejects.toBeInstanceOf(PlanUnavailableError);
  });

  it("is for owners and admins only and stays inside the community", async () => {
    const { harness, paid } = await paidSetup();
    const other = await paidSetup();
    const moderator = await insertMember(admin.db, paid.communityId, "moderator");

    for (const actor of [moderator, paid.memberId, other.paid.ownerId]) {
      await expect(
        harness.service.grantComp(user(actor), paid.communityId, { userId: paid.memberId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        harness.service.listCompInvitations(user(actor), paid.communityId),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const comp = await granted(harness, paid, paid.memberId);
    const invited = await harness.service.grantComp(user(paid.ownerId), paid.communityId, {
      email: "someone@example.test",
    });
    if (invited.kind !== "invited") throw new Error("expected an invitation");
    await expect(
      other.harness.service.revokeComp(user(other.paid.ownerId), other.paid.communityId, comp.id),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
    await expect(
      other.harness.service.withdrawCompInvitation(
        user(other.paid.ownerId),
        other.paid.communityId,
        invited.invitation.id,
      ),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
    expect(
      await other.harness.service.listComps(user(other.paid.ownerId), other.paid.communityId),
    ).toEqual([]);
    const stored = await admin.db
      .select({ communityId: compInvitations.communityId })
      .from(compInvitations)
      .where(eq(compInvitations.id, invited.invitation.id));
    expect(stored).toEqual([{ communityId: paid.communityId }]);
  });
});

async function granted(harness: Harness, paid: PaidCommunity, userId: string) {
  const result = await harness.service.grantComp(user(paid.ownerId), paid.communityId, { userId });
  if (result.kind !== "granted") throw new Error("expected a grant");
  return result.comp;
}
