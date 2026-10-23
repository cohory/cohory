import {
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  runInCommunity,
  withCommunity,
  communitySlugSchema,
  leaveMembership,
  type CommunityId,
} from "@cohory/db";
import { memberships, outbox, posts, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { domainEventsPayloadSchema, domainEventsTopic } from "./domain";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);

let communityId: CommunityId;

async function insertUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name: "Trigger", email: `trigger-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

async function eventsFor(userId: string) {
  const rows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, domainEventsTopic)));
  return rows
    .flatMap((row) => domainEventsPayloadSchema.parse(row.payload).events)
    .filter((event) => "userId" in event.payload && event.payload.userId === userId);
}

beforeAll(async () => {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`domain-${newId().slice(-12)}`),
    name: "Domain events",
  });
  communityId = community.id;
});

afterAll(async () => {
  await pool.end();
});

describe("membership domain events", () => {
  it("appends member.joined when a membership becomes active and member.removed when it ends", async () => {
    const userId = await insertUser();
    await runInCommunity(withCommunity(db, communityId), async ({ tx, values, where }) => {
      await tx.insert(memberships).values(values({ userId, role: "member", status: "pending" }));
      await tx
        .update(memberships)
        .set({ status: "active", joinedAt: new Date() })
        .where(where(memberships, eq(memberships.userId, userId)));
      await tx
        .update(memberships)
        .set({ role: "moderator" })
        .where(where(memberships, eq(memberships.userId, userId)));
      await tx
        .update(memberships)
        .set({ status: "banned", role: "member" })
        .where(where(memberships, eq(memberships.userId, userId)));
      const setting = await tx.execute<{ value: string }>(
        sql`select current_setting('app.community_id', true) as value`,
      );
      expect(setting.rows[0]?.value).toBe(communityId);
    });
    const events = await eventsFor(userId);
    expect(events.map((event) => event.type)).toEqual(["member.joined", "member.removed"]);
    expect(events[1]?.payload).toMatchObject({
      communityId,
      userId,
      status: "banned",
      reason: "banned",
    });
  });

  it("says whether a member left or was removed", async () => {
    const leaver = await insertUser();
    const removed = await insertUser();
    const scope = withCommunity(db, communityId);
    for (const userId of [leaver, removed]) {
      await runInCommunity(scope, async ({ tx, values }) => {
        await tx
          .insert(memberships)
          .values(values({ userId, role: "member", status: "active", joinedAt: new Date() }));
      });
    }

    await leaveMembership(scope, leaver);
    await runInCommunity(scope, async ({ tx, where }) => {
      await tx
        .update(memberships)
        .set({ status: "removed" })
        .where(where(memberships, eq(memberships.userId, removed)));
    });

    expect((await eventsFor(leaver)).at(-1)?.payload).toMatchObject({
      status: "removed",
      reason: "left",
    });
    expect((await eventsFor(removed)).at(-1)?.payload).toMatchObject({
      status: "removed",
      reason: "removed",
    });
  });

  it("appends nothing while a migration import writes memberships", async () => {
    const userId = await insertUser();
    await runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
      await tx.execute(sql`select set_config('app.migration_manager', 'on', true)`);
      await tx
        .insert(memberships)
        .values(values({ userId, role: "member", status: "active", joinedAt: new Date() }));
    });
    expect(await eventsFor(userId)).toEqual([]);
  });
});

describe("last seen", () => {
  it("moves last_seen_at forward when the member posts, at most once an hour", async () => {
    const userId = await insertUser();
    const joinedAt = new Date("2026-01-01T00:00:00.000Z");
    const scope = withCommunity(db, communityId);
    await runInCommunity(scope, async ({ tx, values }) => {
      await tx
        .insert(memberships)
        .values(values({ userId, role: "member", status: "active", joinedAt }));
    });
    async function post(createdAt: Date) {
      await runInCommunity(scope, async ({ tx, values }) => {
        await tx.insert(posts).values(
          values({
            authorId: userId,
            body: { type: "doc", content: [] },
            bodyHtml: "",
            bodyText: "",
            excerpt: "",
            createdAt,
          }),
        );
      });
    }
    async function lastSeen() {
      return runInCommunity(scope, async ({ tx, where }) => {
        const [row] = await tx
          .select({ lastSeenAt: memberships.lastSeenAt })
          .from(memberships)
          .where(where(memberships, eq(memberships.userId, userId)));
        return row?.lastSeenAt?.toISOString() ?? null;
      });
    }
    await post(new Date("2026-03-01T10:00:00.000Z"));
    expect(await lastSeen()).toBe("2026-03-01T10:00:00.000Z");
    await post(new Date("2026-03-01T10:30:00.000Z"));
    expect(await lastSeen()).toBe("2026-03-01T10:00:00.000Z");
    await post(new Date("2026-02-01T10:00:00.000Z"));
    expect(await lastSeen()).toBe("2026-03-01T10:00:00.000Z");
    await post(new Date("2026-03-01T12:00:00.000Z"));
    expect(await lastSeen()).toBe("2026-03-01T12:00:00.000Z");
  });
});
