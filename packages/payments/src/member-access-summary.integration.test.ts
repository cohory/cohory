import { ForbiddenError } from "@cohory/authz";
import type { Database } from "@cohory/db";
import { compedMemberships } from "@cohory/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PaymentsValidationError } from "./errors";
import { cloudEnv, insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
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

interface Setup {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly payerId: string;
  readonly pastDueId: string;
  readonly cancellingId: string;
  readonly compedId: string;
  readonly moderatorId: string;
}

async function setup(): Promise<Setup> {
  const harness = createHarness(probe.db, cloudEnv(), null);
  const paid = await setupPaidCommunity(admin.db, harness);
  const payerId = await insertMember(admin.db, paid.communityId, "member");
  const pastDueId = await insertMember(admin.db, paid.communityId, "member");
  const cancellingId = await insertMember(admin.db, paid.communityId, "member");
  const compedId = await insertMember(admin.db, paid.communityId, "member");
  const moderatorId = await insertMember(admin.db, paid.communityId, "moderator");
  await mirrorSubscription(admin.db, paid.communityId, { userId: payerId, planId: paid.planId });
  await mirrorSubscription(admin.db, paid.communityId, {
    userId: pastDueId,
    planId: paid.planId,
    accessState: "grace",
    providerStatus: "past_due",
  });
  await mirrorSubscription(admin.db, paid.communityId, {
    userId: cancellingId,
    planId: paid.planId,
    cancelAtPeriodEnd: true,
  });
  await admin.db.insert(compedMemberships).values([
    { communityId: paid.communityId, userId: compedId, grantedBy: paid.ownerId },
    {
      communityId: paid.communityId,
      userId: paid.memberId,
      grantedBy: paid.ownerId,
      endedAt: new Date("2020-01-01T00:00:00Z"),
      endReason: "revoked",
    },
  ]);
  return { harness, paid, payerId, pastDueId, cancellingId, compedId, moderatorId };
}

function accessOf(map: ReadonlyMap<string, { access: string }>): Record<string, string> {
  return Object.fromEntries([...map].map(([userId, entry]) => [userId, entry.access]));
}

describe("listMemberAccess", () => {
  it("tells the owner and admins who pays, who is past due, cancelling, or has free access", async () => {
    const s = await setup();

    for (const staffId of [s.paid.ownerId, s.paid.adminId]) {
      const map = await s.harness.service.listMemberAccess(user(staffId), s.paid.communityId);

      expect(accessOf(map)).toEqual({
        [s.payerId]: "paying_monthly",
        [s.pastDueId]: "past_due",
        [s.cancellingId]: "cancelling",
        [s.compedId]: "free_access",
      });
    }
  });

  it("limits the answer to the people asked about", async () => {
    const s = await setup();

    const map = await s.harness.service.listMemberAccess(user(s.paid.ownerId), s.paid.communityId, [
      s.payerId,
      s.paid.memberId,
    ]);

    expect(accessOf(map)).toEqual({ [s.payerId]: "paying_monthly" });
  });

  it("refuses moderators, who cannot see payments", async () => {
    const s = await setup();

    await expect(
      s.harness.service.listMemberAccess(user(s.moderatorId), s.paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses regular members", async () => {
    const s = await setup();

    await expect(
      s.harness.service.listMemberAccess(user(s.paid.memberId), s.paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the owner of another community", async () => {
    const s = await setup();
    const other = await setupPaidCommunity(admin.db, s.harness);

    await expect(
      s.harness.service.listMemberAccess(user(other.ownerId), s.paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never returns another community's subscribers", async () => {
    const s = await setup();
    const other = await setupPaidCommunity(admin.db, s.harness);

    const map = await s.harness.service.listMemberAccess(user(other.ownerId), other.communityId, [
      s.payerId,
    ]);

    expect(map.size).toBe(0);
  });

  it("rejects ids that are not uuids", async () => {
    const s = await setup();

    await expect(
      s.harness.service.listMemberAccess(user(s.paid.ownerId), s.paid.communityId, ["nope"]),
    ).rejects.toBeInstanceOf(PaymentsValidationError);
  });
});
