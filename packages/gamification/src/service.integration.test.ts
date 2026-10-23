import type { Actor } from "@cohory/authz";
import { ForbiddenError } from "@cohory/authz";
import { newId, runInCommunity, setRlsValue, withCommunity, type CommunityId } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { memberStats, pointsLedger } from "@cohory/db/schema";
import { createPostgresPostsRepository, createPostsService, type PostEvent } from "@cohory/posts";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createGamificationService, type GamificationService } from "./service";
import { insertCommunity, insertMember, insertUser, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const fixedNow = new Date("2026-10-18T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

let gamification: GamificationService;
let published: PostEvent[];

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function postsService() {
  return createPostsService({
    repo: createPostgresPostsRepository(db),
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
    onEvents: async ({ events }) => {
      published.push(...events);
      await gamification.recordPostEvents(events);
    },
  });
}

async function statsFor(communityId: CommunityId, userId: string) {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const [row] = await tx
      .select({ points: memberStats.pointsTotal, level: memberStats.level })
      .from(memberStats)
      .where(where(memberStats, eq(memberStats.userId, userId)));
    return row ?? null;
  });
}

async function grant(
  communityId: CommunityId,
  userId: string,
  points: number,
  at: Date,
): Promise<void> {
  const events: PostEvent[] = Array.from({ length: points }, () => ({
    type: "like.added",
    payload: {
      communityId,
      reactionId: newId(),
      subjectType: "post",
      subjectId: newId(),
      subjectAuthorId: userId,
      userId: newId(),
      occurredAt: at.toISOString(),
    },
  }));
  await gamification.recordPostEvents(events);
}

beforeEach(() => {
  published = [];
  gamification = createGamificationService({ db, now: () => fixedNow });
});

afterAll(async () => {
  await close();
});

describe("points from likes", () => {
  it("flows from toggleLike through the handler to member_stats and reverts on unlike", async () => {
    const communityId = await insertCommunity(db);
    const author = await insertMember(db, communityId);
    const fan = await insertMember(db, communityId);
    const posts = postsService();
    const { post } = await posts.createPost(user(author), communityId, { body: doc("Hi") });
    const like = { subjectType: "post" as const, subjectId: post.id };

    await posts.toggleLike(user(fan), communityId, { ...like, liked: true });
    expect(await statsFor(communityId, author)).toEqual({ points: 1, level: 1 });

    const replay = await gamification.recordPostEvents(published);
    expect(replay.inserted).toBe(0);
    expect(await statsFor(communityId, author)).toEqual({ points: 1, level: 1 });

    await posts.toggleLike(user(fan), communityId, { ...like, liked: false });
    expect(await statsFor(communityId, author)).toEqual({ points: 0, level: 1 });

    await posts.toggleLike(user(fan), communityId, { ...like, liked: true });
    expect(await statsFor(communityId, author)).toEqual({ points: 1, level: 1 });
  });

  it("gives nothing for a self like", async () => {
    const communityId = await insertCommunity(db);
    const author = await insertMember(db, communityId);
    const posts = postsService();
    const { post } = await posts.createPost(user(author), communityId, { body: doc("Me") });

    await posts.toggleLike(user(author), communityId, {
      subjectType: "post",
      subjectId: post.id,
      liked: true,
    });

    expect(await statsFor(communityId, author)).toBeNull();
  });

  it("removes the points of a deleted post, its comments, and a deleted comment once", async () => {
    const communityId = await insertCommunity(db);
    const author = await insertMember(db, communityId);
    const fan = await insertMember(db, communityId);
    const posts = postsService();
    const { post } = await posts.createPost(user(author), communityId, { body: doc("Hi") });
    const first = await posts.createComment(user(fan), communityId, post.id, { body: doc("a") });
    const second = await posts.createComment(user(fan), communityId, post.id, { body: doc("b") });
    await posts.toggleLike(user(fan), communityId, {
      subjectType: "post",
      subjectId: post.id,
      liked: true,
    });
    for (const comment of [first.comment, second.comment]) {
      await posts.toggleLike(user(author), communityId, {
        subjectType: "comment",
        subjectId: comment.id,
        liked: true,
      });
    }
    expect(await statsFor(communityId, author)).toMatchObject({ points: 1 });
    expect(await statsFor(communityId, fan)).toMatchObject({ points: 2 });

    await posts.deleteComment(user(fan), communityId, first.comment.id);
    expect(await statsFor(communityId, fan)).toMatchObject({ points: 1 });

    await posts.deletePost(user(author), communityId, post.id);
    expect(await statsFor(communityId, author)).toMatchObject({ points: 0 });
    expect(await statsFor(communityId, fan)).toMatchObject({ points: 0 });

    await gamification.recordPostEvents(published);
    expect(await statsFor(communityId, fan)).toMatchObject({ points: 0 });
  });

  it("levels up at the documented threshold", async () => {
    const communityId = await insertCommunity(db);
    const author = await insertMember(db, communityId);

    await grant(communityId, author, 9, fixedNow);
    expect(await statsFor(communityId, author)).toEqual({ points: 9, level: 1 });
    await grant(communityId, author, 1, fixedNow);
    expect(await statsFor(communityId, author)).toEqual({ points: 10, level: 2 });
  });

  it("rebuilds member_stats from the ledger", async () => {
    const communityId = await insertCommunity(db);
    const ada = await insertMember(db, communityId);
    const grace = await insertMember(db, communityId);
    await grant(communityId, ada, 12, fixedNow);
    await grant(communityId, grace, 3, fixedNow);
    const before = [await statsFor(communityId, ada), await statsFor(communityId, grace)];
    await runInCommunity(withCommunity(db, communityId), ({ tx, where }) =>
      tx.update(memberStats).set({ pointsTotal: 999, level: 9 }).where(where(memberStats)),
    );

    const result = await gamification.recomputeMemberStats(communityId);

    expect(result.members).toBe(2);
    expect([await statsFor(communityId, ada), await statsFor(communityId, grace)]).toEqual(before);
    expect(before).toEqual([
      { points: 12, level: 2 },
      { points: 3, level: 1 },
    ]);
  });
});

describe("leaderboard", () => {
  it("ranks all time by points with ties going to whoever got there first", async () => {
    const communityId = await insertCommunity(db, { levelNames: ["Newcomer", "Member"] });
    const viewer = await insertMember(db, communityId, { name: "Viewer" });
    const early = await insertMember(db, communityId, { name: "Early" });
    const late = await insertMember(db, communityId, { name: "Late" });
    const top = await insertMember(db, communityId, { name: "Top" });
    await grant(communityId, late, 5, new Date(fixedNow.getTime() - 1000));
    await grant(communityId, early, 5, new Date(fixedNow.getTime() - 5000));
    await grant(communityId, top, 10, fixedNow);

    const board = await gamification.getLeaderboard(user(viewer), communityId, { window: "all" });

    expect(board.status).toBe("enabled");
    if (board.status !== "enabled") return;
    expect(board.entries.map((e) => [e.rank, e.name, e.points, e.levelName])).toEqual([
      [1, "Top", 10, "Member"],
      [2, "Early", 5, "Newcomer"],
      [3, "Late", 5, "Newcomer"],
    ]);
    expect(board.viewer).toEqual({
      rank: null,
      points: 0,
      totalPoints: 0,
      level: 1,
      levelName: "Newcomer",
    });
  });

  it("returns the top ten plus the viewer's own rank", async () => {
    const communityId = await insertCommunity(db);
    for (let i = 0; i < 11; i += 1) {
      await grant(communityId, await insertMember(db, communityId), 20 + i, fixedNow);
    }
    const viewer = await insertMember(db, communityId);
    await grant(communityId, viewer, 1, fixedNow);

    const board = await gamification.getLeaderboard(user(viewer), communityId);

    if (board.status !== "enabled") throw new Error("expected an enabled leaderboard");
    expect(board.entries).toHaveLength(10);
    expect(board.entries[0]?.points).toBe(30);
    expect(board.viewer).toMatchObject({ rank: 12, points: 1 });
  });

  it("counts only the last seven days on the rolling board, boundary included", async () => {
    const communityId = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    const inside = await insertMember(db, communityId, { name: "Inside" });
    const outside = await insertMember(db, communityId, { name: "Outside" });
    const boundary = new Date(fixedNow.getTime() - 7 * dayMs);
    await grant(communityId, inside, 2, boundary);
    await grant(communityId, outside, 50, new Date(boundary.getTime() - 1));

    const weekly = await gamification.getLeaderboard(user(viewer), communityId, { window: "7d" });
    const allTime = await gamification.getLeaderboard(user(viewer), communityId, { window: "all" });

    if (weekly.status !== "enabled" || allTime.status !== "enabled") throw new Error("disabled");
    expect(weekly.since).toEqual(boundary);
    expect(weekly.entries.map((e) => [e.name, e.points])).toEqual([["Inside", 2]]);
    expect(weekly.entries[0]?.level).toBe(1);
    expect(allTime.entries.map((e) => e.name)).toEqual(["Outside", "Inside"]);
    expect(allTime.entries[0]?.level).toBe(3);
  });

  it("leaves out removed members", async () => {
    const communityId = await insertCommunity(db);
    const viewer = await insertMember(db, communityId);
    const gone = await insertMember(db, communityId, { status: "removed" });
    await grant(communityId, gone, 4, fixedNow);

    const board = await gamification.getLeaderboard(user(viewer), communityId);

    expect(board).toMatchObject({ status: "enabled", entries: [] });
  });

  it("reports the disabled state when the creator turned gamification off", async () => {
    const communityId = await insertCommunity(db, { gamificationEnabled: false });
    const viewer = await insertMember(db, communityId);

    expect(await gamification.getLeaderboard(user(viewer), communityId)).toEqual({
      status: "disabled",
    });
  });

  it("is for members only and hides other communities' points", async () => {
    const a = await insertCommunity(db);
    const b = await insertCommunity(db);
    const memberOfA = await insertMember(db, a);
    const memberOfB = await insertMember(db, b);
    await grant(a, memberOfA, 3, fixedNow);
    await grant(b, memberOfB, 7, fixedNow);
    const stranger = await insertUser(db);

    const boardB = await gamification.getLeaderboard(user(memberOfB), b);
    if (boardB.status !== "enabled") throw new Error("disabled");
    expect(boardB.entries.map((e) => e.userId)).toEqual([memberOfB]);
    await expect(gamification.getLeaderboard(user(stranger), a)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(gamification.getLeaderboard({ kind: "guest" }, a)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("row level security", () => {
  const probeRole = "cohory_gamification_probe";

  it("shows ledger and stats rows only for app.community_id and blocks ledger updates", async () => {
    await db.execute(
      sql.raw(`
      select pg_advisory_xact_lock(${migrationLockKey});
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
      end $$;
      grant select, insert, update, delete on points_ledger, member_stats to ${probeRole};
    `),
    );
    const a = await insertCommunity(db);
    const b = await insertCommunity(db);
    await grant(a, await insertMember(db, a), 1, fixedNow);
    await grant(b, await insertMember(db, b), 1, fixedNow);

    const seen = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${probeRole}`));
      await setRlsValue(tx, "community_id", a);
      const ledger = await tx.select({ c: pointsLedger.communityId }).from(pointsLedger);
      const stats = await tx.select({ c: memberStats.communityId }).from(memberStats);
      const updated = await tx
        .update(pointsLedger)
        .set({ delta: 5 })
        .returning({ id: pointsLedger.id });
      return { ledger, stats, updated };
    });

    expect(new Set(seen.ledger.map((r) => r.c))).toEqual(new Set([a]));
    expect(new Set(seen.stats.map((r) => r.c))).toEqual(new Set([a]));
    expect(seen.updated).toEqual([]);
  });
});

describe("leaderboard policy", () => {
  it("lets a guest see a public community but not its leaderboard", async () => {
    const communityId = await insertCommunity(db, { privacy: "public" });

    await expect(
      gamification.getLeaderboard({ kind: "guest" }, communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
