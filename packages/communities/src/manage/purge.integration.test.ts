import { newId, parseCommunityId, type CommunityId } from "@cohory/db";
import {
  comments,
  communities,
  memberships,
  notifications,
  payments,
  pointsLedger,
  posts,
  reactions,
} from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityDeletionConflictError } from "../errors";
import {
  insertCast,
  openManageHarness,
  unpaidExit,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";
import { purgeCommunity, purgeDeletedCommunities } from "./purge";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

const body = { type: "doc" as const, content: [] };

async function insertContent(cast: Cast, count: number): Promise<void> {
  const communityId = cast.communityId;
  for (let i = 0; i < count; i += 1) {
    const [post] = await h.admin
      .insert(posts)
      .values({
        communityId,
        authorId: cast.member.userId,
        body,
        bodyHtml: "<p>post</p>",
        bodyText: "post",
        excerpt: "post",
      })
      .returning({ id: posts.id });
    const postId = post?.id ?? "";
    await h.admin.insert(comments).values({
      communityId,
      postId,
      authorId: cast.admin.userId,
      body,
      bodyHtml: "<p>reply</p>",
      bodyText: "reply",
    });
    await h.admin.insert(reactions).values({
      communityId,
      userId: cast.admin.userId,
      subjectType: "post",
      subjectId: postId,
      subjectAuthorId: cast.member.userId,
    });
    await h.admin.insert(pointsLedger).values({
      communityId,
      userId: cast.member.userId,
      delta: 1,
      reason: "like_received",
      sourceType: "reaction",
      sourceId: newId(),
      occurredAt: new Date(),
    });
  }
}

async function rowsIn(communityId: CommunityId) {
  const count = async (table: typeof posts | typeof comments | typeof reactions) =>
    (await h.admin.select().from(table).where(eq(table.communityId, communityId))).length;
  return {
    community: (await h.admin.select().from(communities).where(eq(communities.id, communityId)))
      .length,
    posts: await count(posts),
    comments: await count(comments),
    reactions: await count(reactions),
    ledger: (
      await h.admin.select().from(pointsLedger).where(eq(pointsLedger.communityId, communityId))
    ).length,
    memberships: (
      await h.admin.select().from(memberships).where(eq(memberships.communityId, communityId))
    ).length,
    notifications: (
      await h.admin.select().from(notifications).where(eq(notifications.communityId, communityId))
    ).length,
  };
}

async function deletedCast(posts: number): Promise<{ cast: Cast; id: CommunityId }> {
  const cast = await insertCast(h.admin, "public");
  await insertContent(cast, posts);
  await h.service.archiveCommunity(cast.owner, cast.communityId);
  expect(await h.service.deleteCommunity(cast.owner, cast.communityId)).toEqual({
    kind: "deleted",
  });
  return { cast, id: parseCommunityId(cast.communityId) };
}

describe("purging a deleted community", () => {
  it("hides the community at once and keeps its rows until the purge job runs", async () => {
    const { id } = await deletedCast(1);

    const [row] = await h.admin
      .select({ deletedAt: communities.deletedAt })
      .from(communities)
      .where(eq(communities.id, id));

    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await rowsIn(id)).toMatchObject({ community: 1, posts: 1, ledger: 1 });
  });

  it("deletes posts, comments, and reactions in batches, then the community and its ledger", async () => {
    const { id } = await deletedCast(5);

    const outcome = await purgeCommunity({ db: h.app, paidExit: unpaidExit, batchSize: 2 }, id);

    expect(outcome).toBe("purged");
    expect(await rowsIn(id)).toEqual({
      community: 0,
      posts: 0,
      comments: 0,
      reactions: 0,
      ledger: 0,
      memberships: 0,
      notifications: 0,
    });
  });

  it("removes points ledger rows and notifications in batches before the community row", async () => {
    const { cast, id } = await deletedCast(3);
    for (let i = 0; i < 3; i += 1) {
      await h.admin.insert(notifications).values({
        communityId: id,
        userId: cast.owner.userId,
        actorId: cast.member.userId,
        type: "ownership_transferred",
        subjectType: "community",
        subjectId: newId(),
      });
    }

    const outcome = await purgeCommunity(
      { db: h.app, paidExit: { prepareDeletion: async () => false }, batchSize: 2 },
      id,
    );

    expect(outcome).toBe("not_ready");
    expect(await rowsIn(id)).toMatchObject({ community: 1, ledger: 0, notifications: 0, posts: 0 });
  });

  it("never touches a community that is not marked deleted", async () => {
    const cast = await insertCast(h.admin, "public");
    await insertContent(cast, 2);
    const id = parseCommunityId(cast.communityId);

    expect(await purgeCommunity({ db: h.app, paidExit: unpaidExit, batchSize: 1 }, id)).toBe(
      "not_deleted",
    );
    expect(await rowsIn(id)).toMatchObject({ community: 1, posts: 2, comments: 2, reactions: 2 });
  });

  it("waits while payments is not ready and refuses when a payment record stays attached", async () => {
    const { id } = await deletedCast(1);

    expect(
      await purgeCommunity({ db: h.app, paidExit: { prepareDeletion: async () => false } }, id),
    ).toBe("not_ready");
    expect((await rowsIn(id)).community).toBe(1);

    await h.admin.insert(payments).values({
      communityId: id,
      externalInvoiceId: `in_purge${newId()}`,
      currency: "usd",
      amountMinor: 2900,
      occurredAt: new Date("2026-09-15T00:00:00Z"),
    });
    await expect(
      purgeCommunity({ db: h.app, paidExit: { prepareDeletion: async () => true } }, id),
    ).rejects.toBeInstanceOf(CommunityDeletionConflictError);
    expect((await rowsIn(id)).community).toBe(1);

    expect(await purgeCommunity({ db: h.app, paidExit: unpaidExit }, id)).toBe("purged");
    expect((await rowsIn(id)).community).toBe(0);
  });

  it("tries the community attempted longest ago first, so a stuck one is not picked every run", async () => {
    await deletedCast(0);
    await deletedCast(0);
    const notReady = { prepareDeletion: async () => false };
    const limits = { candidates: 1, purges: 5, budgetMs: 45_000 };
    const first = new Date("2030-01-01T00:00:00Z");
    const second = new Date("2030-01-01T00:01:00Z");
    const stampedAt = async (at: Date) =>
      (
        await h.admin
          .select({ id: communities.id })
          .from(communities)
          .where(sql`${communities.purgeAttemptedAt} = ${at.toISOString()}::timestamptz`)
      ).map((row) => row.id);

    await purgeDeletedCommunities({ db: h.app, paidExit: notReady, now: () => first }, limits);
    await purgeDeletedCommunities({ db: h.app, paidExit: notReady, now: () => second }, limits);

    const firstRun = await stampedAt(first);
    const secondRun = await stampedAt(second);
    expect(firstRun).toHaveLength(1);
    expect(secondRun).toHaveLength(1);
    expect(secondRun).not.toEqual(firstRun);
  });

  it("keeps purging other communities when the oldest ones stay stuck", async () => {
    const stuck: CommunityId[] = [];
    for (let i = 0; i < 6; i += 1) {
      stuck.push((await deletedCast(0)).id);
    }
    const purgeable = await deletedCast(1);
    const failing = stuck[0];
    const paidExit = {
      prepareDeletion: async (
        ...args: Parameters<typeof unpaidExit.prepareDeletion>
      ): Promise<boolean> => {
        const [queries] = args;
        if (queries.communityId === failing) {
          throw new Error("billing blocked");
        }
        return queries.communityId === purgeable.id ? unpaidExit.prepareDeletion(...args) : false;
      },
    };

    const result = await purgeDeletedCommunities({ db: h.app, paidExit });

    expect(result.purged).toBe(1);
    expect(result.failed).toContainEqual({ communityId: failing, code: "Error" });
    expect((await rowsIn(purgeable.id)).community).toBe(0);
    for (const id of stuck) {
      expect((await rowsIn(id)).community).toBe(1);
    }
  });
});
