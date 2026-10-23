import type { Actor } from "@cohory/authz";
import { runInCommunity, setRlsValue, withCommunity, type Database } from "@cohory/db";
import { memberships, reviews } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createReviewsService } from "./service";
import { insertCommunity, insertMember, openProbeDb, openTestDb } from "./test/fixtures";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const now = new Date("2026-10-20T12:00:00.000Z");
const body = "Clear lessons and a kind group of people.";

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function serviceFor(db: Database) {
  return createReviewsService({
    db,
    now: () => now,
    tenure: async (_communityId, userIds) =>
      new Map(
        userIds.map((id) => [
          id,
          {
            providerStatus: "active",
            accessState: "granted" as const,
            interval: "month" as const,
            paidSince: new Date("2026-01-01T00:00:00Z"),
          },
        ]),
      ),
  });
}

describe("reviews under row level security", () => {
  it("writes and reads reviews as the application role", async () => {
    const communityId = await insertCommunity(admin.db);
    const member = await insertMember(admin.db, communityId);
    const service = serviceFor(probe.db);

    await service.createReview(user(member), communityId, { rating: 5, body });

    expect((await service.listReviews({ kind: "guest" }, communityId)).data).toHaveLength(1);
  });

  it("returns no review rows without the community setting", async () => {
    const communityId = await insertCommunity(admin.db);
    const member = await insertMember(admin.db, communityId);
    await serviceFor(probe.db).createReview(user(member), communityId, { rating: 4, body });

    const rows = await probe.db.transaction((tx) => tx.select().from(reviews));
    expect(rows).toEqual([]);
  });

  it("hides a banned member's review through the membership trigger", async () => {
    const communityId = await insertCommunity(admin.db);
    const member = await insertMember(admin.db, communityId);
    const service = serviceFor(probe.db);
    await service.createReview(user(member), communityId, { rating: 1, body });

    await runInCommunity(withCommunity(probe.db, communityId), async ({ tx, where }) => {
      await tx
        .update(memberships)
        .set({ status: "banned" })
        .where(where(memberships, eq(memberships.userId, member)));
    });

    expect((await service.listReviews({ kind: "guest" }, communityId)).data).toHaveLength(0);
    const [row] = await admin.db
      .select({ removedAt: reviews.authorRemovedAt })
      .from(reviews)
      .where(eq(reviews.communityId, communityId));
    expect(row?.removedAt).not.toBeNull();
  });

  it("anonymizes only the purged account's own reviews under the purge setting", async () => {
    const communityId = await insertCommunity(admin.db);
    const erased = await insertMember(admin.db, communityId);
    const kept = await insertMember(admin.db, communityId);
    const service = serviceFor(probe.db);
    await service.createReview(user(erased), communityId, { rating: 3, body });
    await service.createReview(user(kept), communityId, { rating: 5, body });

    await probe.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", erased);
      await tx.execute(sql`select set_config('app.account_purge', 'on', true)`);
      await tx
        .update(reviews)
        .set({ membershipId: null, anonymizedAt: now })
        .where(eq(reviews.authorId, erased));
    });

    const rows = await admin.db
      .select({ authorId: reviews.authorId, anonymizedAt: reviews.anonymizedAt })
      .from(reviews)
      .where(eq(reviews.communityId, communityId));
    expect(rows.find((row) => row.authorId === erased)?.anonymizedAt).toEqual(now);
    expect(rows.find((row) => row.authorId === kept)?.anonymizedAt).toBeNull();
    const [anonymized] = (await service.listReviews({ kind: "guest" }, communityId, { rating: 3 }))
      .data;
    expect(anonymized).toMatchObject({
      author: { id: null, name: "Former member", image: null },
      statusLabel: "Former member",
    });
  });
});
