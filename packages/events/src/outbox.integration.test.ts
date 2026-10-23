import {
  appendOutbox,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  getQueueDatabase,
  newId,
  parseAdminDatabaseEnv,
  type CommunityId,
} from "@cohory/db";
import { outbox } from "@cohory/db/schema";
import type { PostEvent } from "@cohory/posts";
import { eq, inArray, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createPostEventsOutboxPublisher,
  createPostEventsSender,
  gamificationPointsJob,
  notificationsFanoutJob,
} from "./dispatch";
import { pruneOutbox, relayOutbox, type OutboxPublisher } from "./outbox";

const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const pool = createPool(adminUrl);
const db = createDb(pool);
const bossSchema = "pgboss_outbox_test";
const boss = new PgBoss({ connectionString: adminUrl, schema: bossSchema, supervise: false });

let communityId: CommunityId;

beforeAll(async () => {
  await boss.start();
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`outbox-${newId().slice(-12)}`),
    name: "Outbox",
  });
  communityId = community.id;
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await db.execute(sql.raw(`drop schema if exists ${bossSchema} cascade`));
  await pool.end();
});

function likeEvent(): PostEvent {
  return {
    type: "like.added",
    payload: {
      communityId,
      reactionId: newId(),
      subjectType: "post",
      subjectId: newId(),
      subjectAuthorId: newId(),
      userId: newId(),
      occurredAt: "2026-10-18T10:00:00.000Z",
    },
  };
}

async function pendingRow(): Promise<string> {
  const id = newId();
  await appendOutbox(db, {
    id,
    communityId,
    topic: "post_events",
    payload: { events: [likeEvent()] },
  });
  return id;
}

async function rowsById(ids: readonly string[]) {
  return db
    .select()
    .from(outbox)
    .where(inArray(outbox.id, [...ids]));
}

describe("relayOutbox", () => {
  it("publishes pending rows once and marks them published", async () => {
    const ids = [await pendingRow(), await pendingRow()];
    const publish = vi.fn<OutboxPublisher>(async () => undefined);
    const now = new Date("2026-10-18T12:00:00.000Z");

    const first = await relayOutbox(db, publish, { ids, now: () => now });
    const again = await relayOutbox(db, publish, { ids, now: () => now });

    expect(first).toEqual({ published: 2, failed: 0, errors: [] });
    expect(again).toEqual({ published: 0, failed: 0, errors: [] });
    expect(publish.mock.calls.map(([row]) => row.id)).toEqual(ids);
    const rows = await rowsById(ids);
    expect(rows.map((row) => [row.publishedAt, row.attempts])).toEqual([
      [now, 1],
      [now, 1],
    ]);
  });

  it("keeps a failed row pending with the error name and retries it later", async () => {
    const [id] = [await pendingRow()];
    const failing = vi.fn<OutboxPublisher>(async () => {
      throw new TypeError("queue down");
    });

    const failed = await relayOutbox(db, failing, { ids: [id] });
    const [afterFailure] = await rowsById([id]);
    const retried = await relayOutbox(db, async () => undefined, { ids: [id] });
    const [afterRetry] = await rowsById([id]);

    expect(failed).toEqual({ published: 0, failed: 1, errors: ["TypeError"] });
    expect(afterFailure).toMatchObject({ publishedAt: null, attempts: 1, lastError: "TypeError" });
    expect(retried.published).toBe(1);
    expect(afterRetry).toMatchObject({ attempts: 2, lastError: null });
    expect(afterRetry?.publishedAt).toBeInstanceOf(Date);
  });

  it("lets concurrent relays split the rows without publishing any twice", async () => {
    const ids = [await pendingRow(), await pendingRow(), await pendingRow(), await pendingRow()];
    const seen: string[] = [];
    const slow: OutboxPublisher = async (row) => {
      seen.push(row.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    const results = await Promise.all([
      relayOutbox(db, slow, { ids }),
      relayOutbox(db, slow, { ids }),
    ]);

    expect(results.reduce((sum, result) => sum + result.published, 0)).toBe(4);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("holds no row lock while it publishes", async () => {
    const id = await pendingRow();
    const lockedElsewhere: boolean[] = [];
    const probe: OutboxPublisher = async (row) => {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);
        return tx.execute(sql`select id from outbox where id = ${row.id} for update nowait`);
      });
      lockedElsewhere.push(result.rows.length === 1);
    };

    const result = await relayOutbox(db, probe, { ids: [id] });

    expect(result.published).toBe(1);
    expect(lockedElsewhere).toEqual([true]);
  });

  it("skips a row leased by another relay until the lease runs out", async () => {
    const id = await pendingRow();
    const now = new Date("2026-10-18T12:00:00.000Z");
    await db
      .update(outbox)
      .set({ claimedUntil: new Date(now.getTime() + 30_000) })
      .where(eq(outbox.id, id));
    const publish = vi.fn<OutboxPublisher>(async () => undefined);

    const whileLeased = await relayOutbox(db, publish, { ids: [id], now: () => now });
    const afterLease = await relayOutbox(db, publish, {
      ids: [id],
      now: () => new Date(now.getTime() + 60_000),
    });

    expect(whileLeased.published).toBe(0);
    expect(afterLease.published).toBe(1);
    const [row] = await rowsById([id]);
    expect(row).toMatchObject({ attempts: 1, claimedUntil: null });
  });

  it("leaves a row alone when its lease passed to another relay during a slow publish", async () => {
    const id = await pendingRow();
    const now = new Date("2026-10-18T12:00:00.000Z");
    const otherLease = new Date(now.getTime() + 2 * 60_000);
    const slowThenFails: OutboxPublisher = async () => {
      await db.update(outbox).set({ claimedUntil: otherLease }).where(eq(outbox.id, id));
      throw new TypeError("publish timed out");
    };

    const result = await relayOutbox(db, slowThenFails, { ids: [id], now: () => now });

    expect(result).toEqual({ published: 0, failed: 0, errors: [] });
    const [row] = await rowsById([id]);
    expect(row).toMatchObject({ attempts: 0, lastError: null, claimedUntil: otherLease });
  });

  it("neither marks nor counts a publish once another relay holds the lease", async () => {
    const id = await pendingRow();
    const now = new Date("2026-10-18T12:00:00.000Z");
    const otherLease = new Date(now.getTime() + 2 * 60_000);
    const slow: OutboxPublisher = async () => {
      await db.update(outbox).set({ claimedUntil: otherLease }).where(eq(outbox.id, id));
    };

    const result = await relayOutbox(db, slow, { ids: [id], now: () => now });

    expect(result).toEqual({ published: 0, failed: 0, errors: [] });
    const [row] = await rowsById([id]);
    expect(row).toMatchObject({ publishedAt: null, attempts: 0, claimedUntil: otherLease });
  });

  it("prunes published rows older than the cutoff and keeps pending ones", async () => {
    const published = await pendingRow();
    const pending = await pendingRow();
    await relayOutbox(db, async () => undefined, {
      ids: [published],
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const removed = await pruneOutbox(db, new Date("2026-02-01T00:00:00.000Z"));

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await rowsById([published])).toEqual([]);
    expect(await rowsById([pending])).toHaveLength(1);
  });

  it("prunes in small batches until no published row is older than the cutoff", async () => {
    const published = await Promise.all([1, 2, 3, 4, 5].map(() => pendingRow()));
    const pending = await pendingRow();
    await relayOutbox(db, async () => undefined, {
      ids: published,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const removed = await pruneOutbox(db, new Date("2026-02-01T00:00:00.000Z"), {
      batchSize: 2,
    });

    expect(removed).toBeGreaterThanOrEqual(5);
    expect(await rowsById(published)).toEqual([]);
    expect(await rowsById([pending])).toHaveLength(1);
  });
});

describe("post events through pg-boss", () => {
  it("creates exactly one job per consumer queue even when a row is relayed twice", async () => {
    const id = await pendingRow();
    const publish = createPostEventsOutboxPublisher(createPostEventsSender(async () => boss));

    await relayOutbox(db, publish, { ids: [id] });
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);
      await tx.update(outbox).set({ publishedAt: null }).where(eq(outbox.id, id));
    });
    await relayOutbox(db, publish, { ids: [id] });

    const jobs = await db.execute<{ name: string; count: string }>(
      sql.raw(
        `select name, count(*)::text as count from ${bossSchema}.job where id = '${id}' group by name order by name`,
      ),
    );
    expect(jobs.rows).toEqual([
      { name: gamificationPointsJob, count: "1" },
      { name: notificationsFanoutJob, count: "1" },
    ]);
  });

  it("deduplicates by the outbox id even when the singleton keys differ", async () => {
    const jobId = newId();
    const send = createPostEventsSender(async () => boss);

    await send([likeEvent()], jobId);
    await send([likeEvent()], jobId);

    const jobs = await db.execute<{ count: string }>(
      sql.raw(`select count(*)::text as count from ${bossSchema}.job where id = '${jobId}'`),
    );
    expect(jobs.rows).toEqual([{ count: "2" }]);
  });
});

describe("senders on the shared queue pool", () => {
  it("lets several pg-boss senders queue jobs over one small pool", async () => {
    const senders = [1, 2].map(
      () =>
        new PgBoss({
          db: getQueueDatabase(),
          schema: bossSchema,
          supervise: false,
          schedule: false,
        }),
    );
    const queue = `shared-pool-${newId().slice(-8)}`;
    try {
      for (const sender of senders) {
        await sender.start();
      }
      await senders[0]?.createQueue(queue);
      const ids = await Promise.all(senders.map((sender) => sender.send(queue, { ok: true })));

      const jobs = await db.execute<{ count: string }>(
        sql.raw(`select count(*)::text as count from ${bossSchema}.job where name = '${queue}'`),
      );
      expect(ids.every((id) => typeof id === "string")).toBe(true);
      expect(jobs.rows[0]?.count).toBe("2");
    } finally {
      await Promise.all(senders.map((sender) => sender.stop({ graceful: false })));
    }
  });
});
