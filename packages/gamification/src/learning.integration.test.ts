import type { Actor } from "@cohory/authz";
import {
  newId,
  runInCommunity,
  setMembershipStatus,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { communities, memberStats, pointsLedger } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import type { LearningActivity } from "./learning";
import { createGamificationService } from "./service";
import { insertCommunity, insertMember, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const now = new Date("2026-10-22T12:00:00.000Z");
const earlier = new Date("2026-10-22T09:00:00.000Z");
const gamification = createGamificationService({ db, now: () => now });

afterAll(async () => {
  await close();
});

function owner(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

async function learningCommunity(flags: {
  lessons?: boolean;
  events?: boolean;
  gamification?: boolean;
}): Promise<CommunityId> {
  const communityId = await insertCommunity(db);
  await db
    .update(communities)
    .set({
      pointsForLessons: flags.lessons ?? false,
      pointsForEvents: flags.events ?? false,
      gamificationEnabled: flags.gamification ?? true,
    })
    .where(eq(communities.id, communityId));
  return communityId;
}

function lesson(userId: string, at = earlier): LearningActivity {
  return { kind: "lesson", userId, sourceId: newId(), occurredAt: at };
}

function event(userId: string, at = earlier): LearningActivity {
  return { kind: "event", userId, sourceId: newId(), occurredAt: at };
}

async function pointsOf(communityId: CommunityId, userId: string): Promise<number> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const [row] = await tx
      .select({ points: memberStats.pointsTotal })
      .from(memberStats)
      .where(where(memberStats, eq(memberStats.userId, userId)));
    return row?.points ?? 0;
  });
}

describe("points for learning", () => {
  it("gives a point for each finished lesson when the creator turned lesson points on", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const member = await insertMember(db, communityId);

    const result = await gamification.recordLearningActivities(communityId, [
      lesson(member),
      lesson(member),
      event(member),
    ]);

    expect(result.inserted).toBe(2);
    expect(await pointsOf(communityId, member)).toBe(2);
  });

  it("gives a point for each attended event when event points are on", async () => {
    const communityId = await learningCommunity({ events: true });
    const member = await insertMember(db, communityId);

    await gamification.recordLearningActivities(communityId, [lesson(member), event(member)]);

    expect(await pointsOf(communityId, member)).toBe(1);
  });

  it("gives nothing while learning points are off, the default", async () => {
    const communityId = await insertCommunity(db);
    const member = await insertMember(db, communityId);

    const result = await gamification.recordLearningActivities(communityId, [
      lesson(member),
      event(member),
    ]);

    expect(result.inserted).toBe(0);
    expect(await pointsOf(communityId, member)).toBe(0);
  });

  it("gives nothing while levels and points are turned off", async () => {
    const communityId = await learningCommunity({
      lessons: true,
      events: true,
      gamification: false,
    });
    const member = await insertMember(db, communityId);

    await gamification.recordLearningActivities(communityId, [lesson(member), event(member)]);

    expect(await pointsOf(communityId, member)).toBe(0);
  });

  it("counts the same lesson once however often it is recorded", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const member = await insertMember(db, communityId);
    const finished = lesson(member);

    await gamification.recordLearningActivities(communityId, [finished]);
    const again = await gamification.recordLearningActivities(communityId, [finished, finished]);

    expect(again.inserted).toBe(0);
    expect(await pointsOf(communityId, member)).toBe(1);
  });

  it("skips learning that happened before the member's points were reset", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const creator = await insertMember(db, communityId, { role: "owner" });
    const member = await insertMember(db, communityId);
    await gamification.recordLearningActivities(communityId, [lesson(member)]);
    await gamification.resetMemberPoints(owner(creator), communityId, member);

    await gamification.recordLearningActivities(communityId, [
      lesson(member, new Date(now.getTime() - 1)),
      lesson(member, new Date(now.getTime() + 1)),
    ]);

    expect(await pointsOf(communityId, member)).toBe(1);
  });

  it("writes the points into the given community only", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const other = await learningCommunity({ lessons: true });
    const member = await insertMember(db, communityId);

    await gamification.recordLearningActivities(communityId, [lesson(member)]);

    const rows = await db
      .select({ communityId: pointsLedger.communityId, reason: pointsLedger.reason })
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, member));
    expect(rows).toEqual([{ communityId, reason: "lesson_completed" }]);
    expect(await pointsOf(other, member)).toBe(0);
  });

  it("gives nothing to a member banned before the event ended", async () => {
    const communityId = await learningCommunity({ events: true });
    const member = await insertMember(db, communityId);
    await setMembershipStatus(withCommunity(db, communityId), member, "banned");

    const result = await gamification.recordLearningActivities(communityId, [event(member)]);

    expect(result.inserted).toBe(0);
    expect(await pointsOf(communityId, member)).toBe(0);
  });

  it("gives nothing to a member removed after finishing a lesson but before the job ran", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const member = await insertMember(db, communityId);
    const kept = await insertMember(db, communityId);
    const finished = lesson(member);
    await setMembershipStatus(withCommunity(db, communityId), member, "removed");

    const result = await gamification.recordLearningActivities(communityId, [
      finished,
      lesson(kept),
    ]);

    expect(result.inserted).toBe(1);
    expect(await pointsOf(communityId, member)).toBe(0);
    expect(await pointsOf(communityId, kept)).toBe(1);
  });

  it("gives nothing to someone who never joined the community", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const other = await learningCommunity({ lessons: true });
    const outsider = await insertMember(db, other);

    const result = await gamification.recordLearningActivities(communityId, [lesson(outsider)]);

    expect(result.inserted).toBe(0);
  });

  it("writes only sources the ledger does not have yet", async () => {
    const communityId = await learningCommunity({ lessons: true });
    const member = await insertMember(db, communityId);
    const first = lesson(member);
    await gamification.recordLearningActivities(communityId, [first]);
    const ids: string[] = [];
    const counting = createGamificationService({
      db,
      now: () => now,
      newId: () => {
        const id = newId();
        ids.push(id);
        return id;
      },
    });

    const result = await counting.recordLearningActivities(communityId, [first, lesson(member)]);

    expect(result.inserted).toBe(1);
    expect(ids).toHaveLength(1);
  });

  it("lists only communities with levels on and at least one learning point setting", async () => {
    const lessons = await learningCommunity({ lessons: true });
    const events = await learningCommunity({ events: true });
    const off = await learningCommunity({});
    const disabled = await learningCommunity({ lessons: true, gamification: false });

    const listed = await gamification.learningPointsCommunities();
    const ids = new Set(listed.map((row) => row.communityId));

    expect(listed).toContainEqual({ communityId: lessons, lessons: true, events: false });
    expect(listed).toContainEqual({ communityId: events, lessons: false, events: true });
    expect(ids.has(off)).toBe(false);
    expect(ids.has(disabled)).toBe(false);
  });
});
