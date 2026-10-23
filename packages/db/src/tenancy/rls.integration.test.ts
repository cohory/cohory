import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRlsValue } from "../tenancy/session";

import { newId } from "../ids";
import { createCommunity } from "../repositories/communities";
import {
  addMembership,
  getMembershipRole,
  listMembershipsForCommunity,
} from "../repositories/memberships";
import { memberships } from "../schema";
import { createDb, createPool, parseAdminDatabaseEnv } from "../index";
import { migrationLockKey } from "../migrations";
import { insertUser, openTestDb, uniqueSlug } from "../test/fixtures";
import { withCommunity, type CommunityId } from "./scope";

const probeRole = "cohory_rls_probe";
const { db, close } = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

let communityA: CommunityId;
let communityB: CommunityId;

async function asProbe<T>(
  communityId: CommunityId | null,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${probeRole}`));
    if (communityId) {
      await setRlsValue(tx, "community_id", communityId);
    }
    return fn(tx);
  });
}

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select, insert, update, delete on memberships to ${probeRole};
    grant insert on outbox to ${probeRole};
  `),
  );
  const a = await createCommunity(db, { slug: uniqueSlug("rls-a"), name: "RLS A" });
  const b = await createCommunity(db, { slug: uniqueSlug("rls-b"), name: "RLS B" });
  communityA = a.id;
  communityB = b.id;
  await addMembership(withCommunity(db, a.id), { userId: await insertUser(db), status: "active" });
  await addMembership(withCommunity(db, b.id), { userId: await insertUser(db), status: "active" });
});

afterAll(async () => {
  await probePool.end();
  await close();
});

describe("memberships row level security", () => {
  it("is enabled and forced on the table", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'memberships'`,
    );

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("returns zero rows to a non bypass role without app.community_id", async () => {
    const rows = await asProbe(null, (tx) => tx.select().from(memberships));

    expect(rows).toEqual([]);
  });

  it("returns only rows of the community in app.community_id", async () => {
    const rows = await asProbe(communityA, (tx) => tx.select().from(memberships));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.communityId === communityA)).toBe(true);
  });

  it("rejects a write whose community_id does not match app.community_id", async () => {
    const userId = await insertUser(db);

    await expect(
      asProbe(communityA, (tx) =>
        tx
          .insert(memberships)
          .values({ id: newId(), communityId: communityB, userId, status: "active" }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("lets the scoped repositories read and write as a non bypass role", async () => {
    const scope = withCommunity(probeDb, communityA);
    const userId = await insertUser(db);

    await addMembership(scope, { userId, role: "moderator", status: "active" });
    const rows = await listMembershipsForCommunity(scope);

    expect(rows.some((row) => row.userId === userId)).toBe(true);
    expect(rows.every((row) => row.communityId === communityA)).toBe(true);
    expect(await getMembershipRole(scope, userId)).toBe("moderator");
    expect(await getMembershipRole(withCommunity(probeDb, communityB), userId)).toBeNull();
  });
});
