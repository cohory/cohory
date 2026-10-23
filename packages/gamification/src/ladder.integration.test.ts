import type { Actor } from "@cohory/authz";
import { newId, type CommunityId } from "@cohory/db";
import { communities } from "@cohory/db/schema";
import type { PostEvent } from "@cohory/posts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createGamificationService } from "./service";
import { insertCommunity, insertMember, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const now = new Date("2026-10-22T12:00:00.000Z");
const gamification = createGamificationService({ db, now: () => now });

afterAll(async () => {
  await close();
});

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

async function grant(communityId: CommunityId, userId: string, points: number): Promise<void> {
  const events: PostEvent[] = Array.from({ length: points }, () => ({
    type: "like.added",
    payload: {
      communityId,
      reactionId: newId(),
      subjectType: "post",
      subjectId: newId(),
      subjectAuthorId: userId,
      userId: newId(),
      occurredAt: now.toISOString(),
    },
  }));
  await gamification.recordPostEvents(events);
}

async function enabledBoard(viewer: string, communityId: CommunityId) {
  const board = await gamification.getLeaderboard(user(viewer), communityId);
  if (board.status !== "enabled") throw new Error("expected an enabled leaderboard");
  return board;
}

describe("level ladder", () => {
  it("lists all nine levels with names, thresholds and the share of members at each", async () => {
    const communityId = await insertCommunity(db, {
      levelNames: ["Seed", "Sprout", "", "", "", "", "", "", "Oak"],
    });
    const viewer = await insertMember(db, communityId);
    await insertMember(db, communityId);
    await grant(communityId, await insertMember(db, communityId), 12);
    await grant(communityId, await insertMember(db, communityId), 31);

    const { ladder } = await enabledBoard(viewer, communityId);

    expect(ladder).toHaveLength(9);
    expect(ladder.slice(0, 3)).toEqual([
      { level: 1, name: "Seed", minPoints: 0, members: 2, share: 50 },
      { level: 2, name: "Sprout", minPoints: 10, members: 1, share: 25 },
      { level: 3, name: "Level 3", minPoints: 30, members: 1, share: 25 },
    ]);
    expect(ladder[8]).toEqual({ level: 9, name: "Oak", minPoints: 2500, members: 0, share: 0 });
  });

  it("counts only active members of this community", async () => {
    const communityId = await insertCommunity(db);
    const elsewhere = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    await grant(communityId, await insertMember(db, communityId, { status: "removed" }), 40);
    await grant(elsewhere, await insertMember(db, elsewhere), 40);

    const { ladder } = await enabledBoard(viewer, communityId);

    expect(ladder.map((step) => step.members)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("gives the viewer's all time points on the rolling board too", async () => {
    const communityId = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    await grant(communityId, viewer, 12);

    const board = await gamification.getLeaderboard(user(viewer), communityId, { window: "7d" });

    expect(board).toMatchObject({ viewer: { level: 2, totalPoints: 12 } });
  });

  it("says which learning activities earn points", async () => {
    const communityId = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    expect((await enabledBoard(viewer, communityId)).earning).toEqual({
      lessons: false,
      events: false,
    });

    await db
      .update(communities)
      .set({ pointsForLessons: true })
      .where(eq(communities.id, communityId));

    expect((await enabledBoard(viewer, communityId)).earning).toEqual({
      lessons: true,
      events: false,
    });
  });
});
