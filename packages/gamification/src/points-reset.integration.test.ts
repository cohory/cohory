import { ForbiddenError, type Actor } from "@cohory/authz";
import { newId, runInCommunity, withCommunity, type CommunityId } from "@cohory/db";
import { auditLog, memberStats, pointsLedger } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { GamificationCommunityNotFoundError, GamificationValidationError } from "./errors";
import { createGamificationService } from "./service";
import { insertCommunity, insertMember, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
let now = new Date("2026-10-18T12:00:00.000Z");
const gamification = createGamificationService({ db, now: () => now });
const hour = 60 * 60 * 1000;

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

async function likes(communityId: CommunityId, userId: string, count: number, at: Date) {
  await gamification.recordPostEvents(
    Array.from({ length: count }, () => ({
      type: "like.added" as const,
      payload: {
        communityId,
        reactionId: newId(),
        subjectType: "post" as const,
        subjectId: newId(),
        subjectAuthorId: userId,
        userId: newId(),
        occurredAt: at.toISOString(),
      },
    })),
  );
}

async function stats(communityId: CommunityId) {
  return runInCommunity(withCommunity(db, communityId), ({ tx, where }) =>
    tx
      .select({
        userId: memberStats.userId,
        points: memberStats.pointsTotal,
        level: memberStats.level,
      })
      .from(memberStats)
      .where(where(memberStats)),
  );
}

afterAll(async () => {
  await close();
});

describe("points reset", () => {
  it("zeroes everyone, keeps the ledger with reset rows, and writes the audit log", async () => {
    const communityId = await insertCommunity(db);
    const owner = await insertMember(db, communityId, { role: "owner" });
    const ada = await insertMember(db, communityId);
    const bob = await insertMember(db, communityId);
    await likes(communityId, ada, 30, new Date(now.getTime() - 2 * hour));
    await likes(communityId, bob, 4, new Date(now.getTime() - 2 * hour));

    const result = await gamification.resetPoints(user(owner), communityId, {
      confirmation: " Gamification ",
    });

    expect(result).toEqual({ members: 2, points: 34 });
    expect((await stats(communityId)).map((row) => [row.points, row.level])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    const ledger = await db
      .select({ reason: pointsLedger.reason, delta: pointsLedger.delta })
      .from(pointsLedger)
      .where(
        and(eq(pointsLedger.communityId, communityId), eq(pointsLedger.reason, "admin_reset")),
      );
    expect(ledger.map((row) => row.delta).sort((a, b) => a - b)).toEqual([-30, -4]);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.communityId, communityId));
    expect(audit).toMatchObject({
      actorId: owner,
      action: "points.reset",
      metadata: { members: 2, points: 34 },
    });
    const board = await gamification.getLeaderboard(user(owner), communityId);
    expect(board.status === "enabled" ? board.entries : null).toEqual([]);
  });

  it("starts the 7 day ranking over after a reset and keeps new points", async () => {
    const communityId = await insertCommunity(db);
    const admin = await insertMember(db, communityId, { role: "admin" });
    const ada = await insertMember(db, communityId);
    await likes(communityId, ada, 5, new Date(now.getTime() - 3 * hour));

    await gamification.resetPoints(user(admin), communityId, { confirmation: "Gamification" });
    now = new Date(now.getTime() + hour);
    await likes(communityId, ada, 2, now);

    for (const window of ["7d", "all"] as const) {
      const board = await gamification.getLeaderboard(user(admin), communityId, { window });
      expect(board.status === "enabled" ? board.entries.map((e) => e.points) : null).toEqual([2]);
    }
    expect(await gamification.recomputeMemberStats(communityId)).toEqual({ members: 1 });
    expect((await stats(communityId))[0]?.points).toBe(2);
  });

  it("does not go below zero when a like awarded before the reset is removed", async () => {
    const communityId = await insertCommunity(db);
    const admin = await insertMember(db, communityId, { role: "admin" });
    const ada = await insertMember(db, communityId);
    const before = new Date(now.getTime() - 3 * hour);
    const liker = newId();
    const oldLike = { reactionId: newId(), subjectId: newId() };
    await gamification.recordPostEvents([
      {
        type: "like.added",
        payload: {
          communityId,
          ...oldLike,
          subjectType: "post",
          subjectAuthorId: ada,
          userId: liker,
          occurredAt: before.toISOString(),
        },
      },
    ]);

    await gamification.resetPoints(user(admin), communityId, { confirmation: "Gamification" });
    now = new Date(now.getTime() + hour);
    const newLike = { reactionId: newId(), subjectId: newId() };
    await gamification.recordPostEvents([
      {
        type: "like.added",
        payload: {
          communityId,
          ...newLike,
          subjectType: "post",
          subjectAuthorId: ada,
          userId: liker,
          occurredAt: now.toISOString(),
        },
      },
      {
        type: "like.removed",
        payload: {
          communityId,
          ...oldLike,
          subjectType: "post",
          subjectAuthorId: ada,
          userId: liker,
          occurredAt: now.toISOString(),
        },
      },
      {
        type: "post.deleted",
        payload: {
          communityId,
          postId: oldLike.subjectId,
          authorId: ada,
          likes: [{ reactionId: oldLike.reactionId, userId: liker, subjectAuthorId: ada }],
          occurredAt: now.toISOString(),
        },
      },
    ]);

    expect((await stats(communityId))[0]?.points).toBe(1);
    expect(await gamification.recomputeMemberStats(communityId)).toEqual({ members: 1 });
    expect((await stats(communityId))[0]?.points).toBe(1);

    await gamification.recordPostEvents([
      {
        type: "like.removed",
        payload: {
          communityId,
          ...newLike,
          subjectType: "post",
          subjectAuthorId: ada,
          userId: liker,
          occurredAt: now.toISOString(),
        },
      },
    ]);
    expect((await stats(communityId))[0]?.points).toBe(0);
  });

  it("needs the community name typed exactly", async () => {
    const communityId = await insertCommunity(db);
    const owner = await insertMember(db, communityId, { role: "owner" });
    await expect(
      gamification.resetPoints(user(owner), communityId, { confirmation: "gamification" }),
    ).rejects.toBeInstanceOf(GamificationValidationError);
  });

  it("is for admins and the owner only, per community", async () => {
    const communityId = await insertCommunity(db);
    const other = await insertCommunity(db);
    const moderator = await insertMember(db, communityId, { role: "moderator" });
    const member = await insertMember(db, communityId);
    const otherOwner = await insertMember(db, other, { role: "owner" });
    for (const actor of [moderator, member]) {
      await expect(
        gamification.resetPoints(user(actor), communityId, { confirmation: "Gamification" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      gamification.resetPoints(user(otherOwner), communityId, { confirmation: "Gamification" }),
    ).rejects.toBeInstanceOf(GamificationCommunityNotFoundError);
  });

  it("resets one member's points, leaves everyone else's, and audits it", async () => {
    const communityId = await insertCommunity(db);
    const admin = await insertMember(db, communityId, { role: "admin" });
    const ada = await insertMember(db, communityId);
    const bob = await insertMember(db, communityId);
    await likes(communityId, ada, 6, new Date(now.getTime() - 2 * hour));
    await likes(communityId, bob, 3, new Date(now.getTime() - 2 * hour));

    const result = await gamification.resetMemberPoints(user(admin), communityId, ada);

    expect(result).toEqual({ members: 1, points: 6 });
    const byUser = new Map((await stats(communityId)).map((row) => [row.userId, row.points]));
    expect(byUser.get(ada)).toBe(0);
    expect(byUser.get(bob)).toBe(3);
    const audits = await db.select().from(auditLog).where(eq(auditLog.communityId, communityId));
    expect(audits).toContainEqual(
      expect.objectContaining({ action: "points.reset_member", target: ada, actorId: admin }),
    );
    const board = await gamification.getLeaderboard(user(admin), communityId, { window: "7d" });
    expect(board.status === "enabled" ? board.entries.map((e) => e.userId) : null).toEqual([bob]);
  });

  it("does not charge a member twice when a like from before their own reset is removed", async () => {
    const communityId = await insertCommunity(db);
    const admin = await insertMember(db, communityId, { role: "admin" });
    const ada = await insertMember(db, communityId);
    const bob = await insertMember(db, communityId);
    const liker = newId();
    const adaLike = { reactionId: newId(), subjectId: newId() };
    const bobLike = { reactionId: newId(), subjectId: newId() };
    const like = (target: string, ids: typeof adaLike, type: "like.added" | "like.removed") => ({
      type,
      payload: {
        communityId,
        ...ids,
        subjectType: "post" as const,
        subjectAuthorId: target,
        userId: liker,
        occurredAt: now.toISOString(),
      },
    });
    await gamification.recordPostEvents([
      like(ada, adaLike, "like.added"),
      like(bob, bobLike, "like.added"),
    ]);
    now = new Date(now.getTime() + hour);
    await gamification.resetMemberPoints(user(admin), communityId, ada);
    now = new Date(now.getTime() + hour);

    await gamification.recordPostEvents([
      like(ada, adaLike, "like.removed"),
      like(bob, bobLike, "like.removed"),
    ]);

    const byUser = new Map((await stats(communityId)).map((row) => [row.userId, row.points]));
    expect(byUser.get(ada)).toBe(0);
    expect(byUser.get(bob)).toBe(0);
  });

  it("lets only admins and the owner reset a member", async () => {
    const communityId = await insertCommunity(db);
    const moderator = await insertMember(db, communityId, { role: "moderator" });
    const ada = await insertMember(db, communityId);
    await expect(
      gamification.resetMemberPoints(user(moderator), communityId, ada),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
