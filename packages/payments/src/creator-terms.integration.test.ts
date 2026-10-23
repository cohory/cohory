import { addMembership, withCommunity, type Database } from "@cohory/db";
import { creatorTermsAcceptances, users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CreatorTermsRequiredError, EditionMismatchError } from "./errors";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import { createHarness } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function cloudCommunity(creatorTermsVersion = "1") {
  const harness = createHarness(probe.db, cloudEnv({ creatorTermsVersion }));
  const communityId = await insertCommunity(admin.db);
  const ownerId = await insertMember(admin.db, communityId, "owner");
  await admin.db.update(users).set({ emailVerified: true }).where(eq(users.id, ownerId));
  return { harness, communityId, ownerId };
}

async function connectionIn(
  harness: ReturnType<typeof createHarness>,
  ownerId: string,
  communityId: string,
) {
  return (await harness.service.getPaymentsOverview(user(ownerId), communityId)).connection;
}

function acceptancesOf(userId: string) {
  return admin.db
    .select({
      communityId: creatorTermsAcceptances.communityId,
      version: creatorTermsAcceptances.version,
    })
    .from(creatorTermsAcceptances)
    .where(eq(creatorTermsAcceptances.userId, userId));
}

describe("Creator Terms", () => {
  it("refuses to connect Stripe on Cloud until the owner accepts the Creator Terms", async () => {
    const { harness, communityId, ownerId } = await cloudCommunity();

    await expect(harness.service.connectStripe(user(ownerId), communityId)).rejects.toBeInstanceOf(
      CreatorTermsRequiredError,
    );
    await expect(
      harness.service.connectStripe(user(ownerId), communityId, { acceptCreatorTerms: false }),
    ).rejects.toMatchObject({ code: "creator_terms_required" });

    expect(await connectionIn(harness, ownerId, communityId)).toBeNull();
    expect(await acceptancesOf(ownerId)).toEqual([]);
  });

  it("records the configured version when the owner accepts while connecting", async () => {
    const { harness, communityId, ownerId } = await cloudCommunity("2026-10");

    await harness.service.connectStripe(user(ownerId), communityId, { acceptCreatorTerms: true });

    expect(await acceptancesOf(ownerId)).toEqual([{ communityId, version: "2026-10" }]);
    expect(await harness.service.creatorTermsAccepted(user(ownerId), communityId)).toBe(true);
  });

  it("connects without the flag once the owner accepted the current version", async () => {
    const { harness, communityId, ownerId } = await cloudCommunity();
    await harness.service.acceptCreatorTerms(user(ownerId), communityId);

    const result = await harness.service.connectStripe(user(ownerId), communityId);

    expect(result.connection.provider).toBe("stripe_connect");
  });

  it("asks again on connect when the configured version is newer than the accepted one", async () => {
    const before = await cloudCommunity("1");
    await before.harness.service.acceptCreatorTerms(user(before.ownerId), before.communityId);
    const after = createHarness(probe.db, cloudEnv({ creatorTermsVersion: "2" }));

    await expect(
      after.service.connectStripe(user(before.ownerId), before.communityId),
    ).rejects.toBeInstanceOf(CreatorTermsRequiredError);
  });

  it("asks again when the Terms version changes, and records the new acceptance once", async () => {
    const { harness, communityId, ownerId } = await cloudCommunity("1");
    await harness.service.acceptCreatorTerms(user(ownerId), communityId);
    const next = createHarness(probe.db, cloudEnv({ creatorTermsVersion: "2" }));

    expect(await next.service.creatorTermsAccepted(user(ownerId), communityId)).toBe(false);
    await next.service.acceptCreatorTerms(user(ownerId), communityId);
    await next.service.acceptCreatorTerms(user(ownerId), communityId);

    expect((await acceptancesOf(ownerId)).map((row) => row.version).sort()).toEqual(["1", "2"]);
    expect(await next.service.creatorTermsAccepted(user(ownerId), communityId)).toBe(true);
  });

  it("does not let a member who cannot connect payments accept for the community", async () => {
    const { harness, communityId } = await cloudCommunity();
    const memberId = await insertMember(admin.db, communityId, "member");

    await expect(
      harness.service.acceptCreatorTerms(user(memberId), communityId),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await acceptancesOf(memberId)).toEqual([]);
  });

  it("does not count an acceptance in another community", async () => {
    const first = await cloudCommunity();
    const otherCommunity = await insertCommunity(admin.db);
    await addMembership(withCommunity(admin.db, otherCommunity), {
      userId: first.ownerId,
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    });
    await first.harness.service.acceptCreatorTerms(user(first.ownerId), first.communityId);

    expect(
      await first.harness.service.creatorTermsAccepted(user(first.ownerId), otherCommunity),
    ).toBe(false);
  });

  it("has no Creator Terms on the Community Edition", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");

    expect(await harness.service.creatorTermsAccepted(user(ownerId), communityId)).toBe(true);
    await expect(
      harness.service.acceptCreatorTerms(user(ownerId), communityId),
    ).rejects.toBeInstanceOf(EditionMismatchError);
  });
});
