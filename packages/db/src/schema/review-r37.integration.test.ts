import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRlsValue } from "../tenancy/session";

import { createDb, createPool, parseAdminDatabaseEnv, type Database } from "../index";
import { newId } from "../ids";
import { migrationLockKey } from "../migrations";
import { insertUser, openTestDb } from "../test/fixtures";
import {
  communities,
  inviteLinks,
  membershipHolds,
  memberships,
  notificationGroupSources,
  notifications,
} from "./index";

const probeRole = "cohory_review_r37_probe";
const probeTables = ["membership_holds", "notification_group_sources"];

const admin = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function asProbe<T>(
  settings: { community?: string; sweep?: boolean },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return probeDb.transaction(async (tx) => {
    if (settings.community) {
      await setRlsValue(tx, "community_id", settings.community);
    }
    if (settings.sweep) {
      await tx.execute(sql`select set_config('app.membership_hold_sweep', 'on', true)`);
    }
    return fn(tx);
  });
}

function pgCode(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && typeof current.code === "string") return current.code;
  }
  return undefined;
}

async function insertCommunity(): Promise<string> {
  const [row] = await admin.db
    .insert(communities)
    .values({ slug: `r37-${newId().slice(-12)}`, name: "Holds" })
    .returning({ id: communities.id });
  if (!row) throw new Error("community insert returned no row");
  return row.id;
}

async function heldMember(communityId: string): Promise<{ userId: string; inviteId: string }> {
  const userId = await insertUser(admin.db);
  const [invite] = await admin.db
    .insert(inviteLinks)
    .values({ communityId, token: `r37-${newId()}`, createdBy: userId })
    .returning({ id: inviteLinks.id });
  if (!invite) throw new Error("invite insert returned no row");
  await admin.db.insert(memberships).values({ communityId, userId, status: "pending" });
  return { userId, inviteId: invite.id };
}

beforeAll(async () => {
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${probeRole};
        grant select, insert, update, delete on ${probeTables.join(", ")} to ${probeRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await admin.close();
});

describe("migration 0036 tables", () => {
  it.each(probeTables)("has row level security enabled and forced on %s", async (table) => {
    const result = await admin.db.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`);

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it.each([
    ["membership_holds", "membership_holds_pkey"],
    ["notification_group_sources", "notification_group_sources_community_idx"],
  ])("indexes %s from community_id with %s", async (table, index) => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = ${table} and indexname = ${index}`,
    );

    expect(result.rows[0]?.indexdef).toMatch(/\(community_id,/);
  });
});

describe("membership_holds", () => {
  it("refuses a hold whose invite belongs to another community", async () => {
    const communityId = await insertCommunity();
    const otherId = await insertCommunity();
    const { userId } = await heldMember(communityId);
    const other = await heldMember(otherId);

    const error = await admin.db
      .insert(membershipHolds)
      .values({ communityId, userId, inviteId: other.inviteId, expiresAt: new Date() })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(pgCode(error)).toBe("23503");
  });

  it("shows holds only inside their community, and to the sweep across communities", async () => {
    const communityId = await insertCommunity();
    const { userId, inviteId } = await heldMember(communityId);
    await admin.db
      .insert(membershipHolds)
      .values({ communityId, userId, inviteId, expiresAt: new Date() });
    const otherId = await insertCommunity();

    const own = await asProbe({ community: communityId }, (tx) =>
      tx
        .select()
        .from(membershipHolds)
        .where(sql`user_id = ${userId}`),
    );
    const other = await asProbe({ community: otherId }, (tx) =>
      tx
        .select()
        .from(membershipHolds)
        .where(sql`user_id = ${userId}`),
    );
    const sweep = await asProbe({ sweep: true }, (tx) =>
      tx
        .select()
        .from(membershipHolds)
        .where(sql`user_id = ${userId}`),
    );
    const sweepDelete = await asProbe({ sweep: true }, (tx) =>
      tx
        .delete(membershipHolds)
        .where(sql`user_id = ${userId}`)
        .returning(),
    );

    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
    expect(sweep).toHaveLength(1);
    expect(sweepDelete).toHaveLength(0);
  });

  it("goes away with its membership", async () => {
    const communityId = await insertCommunity();
    const { userId, inviteId } = await heldMember(communityId);
    await admin.db
      .insert(membershipHolds)
      .values({ communityId, userId, inviteId, expiresAt: new Date() });

    await admin.db.delete(memberships).where(sql`user_id = ${userId}`);

    const rows = await admin.db
      .select()
      .from(membershipHolds)
      .where(sql`user_id = ${userId}`);
    expect(rows).toHaveLength(0);
  });
});

describe("notification_group_sources", () => {
  it("keeps one row per notification and source, inside the community", async () => {
    const communityId = await insertCommunity();
    const otherId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const [notice] = await admin.db
      .insert(notifications)
      .values({
        communityId,
        userId,
        actorId: userId,
        type: "member_joined",
        subjectType: "community",
        subjectId: communityId,
      })
      .returning({ id: notifications.id });
    if (!notice) throw new Error("notification insert returned no row");

    const first = await asProbe({ community: communityId }, (tx) =>
      tx
        .insert(notificationGroupSources)
        .values({ notificationId: notice.id, sourceKey: "a", communityId })
        .onConflictDoNothing(),
    );
    const again = await asProbe({ community: communityId }, (tx) =>
      tx
        .insert(notificationGroupSources)
        .values({ notificationId: notice.id, sourceKey: "a", communityId })
        .onConflictDoNothing(),
    );
    const crossTenant = await asProbe({ community: otherId }, (tx) =>
      tx
        .insert(notificationGroupSources)
        .values({ notificationId: notice.id, sourceKey: "b", communityId })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        ),
    );

    expect(first.rowCount).toBe(1);
    expect(again.rowCount).toBe(0);
    expect(pgCode(crossTenant)).toBe("42501");
  });
});

describe("notification subject agent_token", () => {
  it("is allowed without a post", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);

    const [row] = await admin.db
      .insert(notifications)
      .values({
        communityId,
        userId,
        actorId: userId,
        type: "token_expiring",
        subjectType: "agent_token",
        subjectId: newId(),
      })
      .returning({ subjectType: notifications.subjectType });

    expect(row?.subjectType).toBe("agent_token");
  });
});

describe("notifications_post_subject", () => {
  it("is added without scanning old rows and still refuses a post subject without a post", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const constraint = await admin.db.execute<{ convalidated: boolean }>(
      sql`select convalidated from pg_constraint where conname = 'notifications_post_subject'`,
    );

    const refused = await admin.db
      .insert(notifications)
      .values({
        communityId,
        userId,
        actorId: userId,
        type: "comment_on_post",
        subjectType: "post",
        subjectId: newId(),
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(constraint.rows).toEqual([{ convalidated: false }]);
    expect(pgCode(refused)).toBe("23514");
  });
});

describe("member removal reason hold_expired", () => {
  it("is recorded when a hold release removes the pending membership", async () => {
    const communityId = await insertCommunity();
    const { userId } = await heldMember(communityId);

    const reason = await admin.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.member_removal_reason', 'hold_expired', true)`);
      const [row] = await tx
        .update(memberships)
        .set({ status: "removed" })
        .where(sql`user_id = ${userId} and community_id = ${communityId}`)
        .returning({ removalReason: memberships.removalReason });
      return row?.removalReason;
    });

    expect(reason).toBe("hold_expired");
  });
});
