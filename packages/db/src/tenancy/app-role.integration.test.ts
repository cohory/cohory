import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureAppRole } from "../app-role";
import { createDb, createPool, newId, parseAdminDatabaseEnv } from "../index";
import { migrationLockKey } from "../migrations";
import { createCommunity } from "../repositories/communities";
import { addMembership, listMembershipsForCommunity } from "../repositories/memberships";
import { memberships, users } from "../schema";
import { insertUser, uniqueSlug } from "../test/fixtures";
import { withCommunity, type CommunityId } from "./scope";

const role = { name: "cohory_app_test", password: newId() };
const env = parseAdminDatabaseEnv();
const adminPool = createPool(env.DATABASE_ADMIN_URL);
const adminDb = createDb(adminPool);

const appUrl = new URL(env.DATABASE_ADMIN_URL);
appUrl.username = role.name;
appUrl.password = role.password;
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let communityId: CommunityId;

beforeAll(async () => {
  await ensureAppRole(adminPool, role);
  const community = await createCommunity(adminDb, { slug: uniqueSlug("app-role"), name: "App" });
  communityId = community.id;
  await addMembership(withCommunity(adminDb, communityId), {
    userId: await insertUser(adminDb),
    status: "active",
  });
});

afterAll(async () => {
  await appPool.end();
  await adminDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${migrationLockKey})`);
    await tx.execute(sql.raw(`drop owned by ${role.name}; drop role ${role.name}`));
  });
  await adminPool.end();
});

describe("application role provisioned by the migration runner", () => {
  it("is neither a superuser nor allowed to bypass row level security", async () => {
    const result = await appDb.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );

    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("sees zero membership rows without app.community_id", async () => {
    expect(await appDb.select().from(memberships)).toEqual([]);
  });

  it("sees the community's memberships through the scoped repository", async () => {
    const rows = await listMembershipsForCommunity(withCommunity(appDb, communityId));

    expect(rows.length).toBe(1);
    expect(rows[0]?.communityId).toBe(communityId);
  });

  it("can write the auth tables, which carry no row level security", async () => {
    const userId = await insertUser(appDb);

    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    await appDb.delete(users).where(eq(users.id, userId));
  });

  it("can create its own schema, as pg-boss does on start", async () => {
    await appDb.execute(sql.raw(`create schema if not exists ${role.name}_schema`));
    await appDb.execute(sql.raw(`drop schema ${role.name}_schema`));
  });
});
