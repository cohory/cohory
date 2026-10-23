import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMemberRemovalReason } from "../tenancy/session";

import { createDb, createPool, parseAdminDatabaseEnv } from "../index";
import { migrationLockKey } from "../migrations";
import { newId } from "../ids";
import { categories, communities, memberships } from "../schema";
import { parseCommunityId, withCommunity } from "../tenancy/scope";
import { insertUser, openTestDb, uniqueSlug } from "../test/fixtures";
import {
  createCommunity,
  createCommunityWithOwner,
  getCommunityById,
  getCommunityBySlug,
} from "./communities";
import {
  getMembership,
  insertMembershipIfAbsent,
  leaveMembership,
  listCommunitiesForUser,
  restoreLeftMembership,
  setMembershipStatus,
} from "./memberships";

const probeRole = "cohory_repo_probe";
const { db, close } = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select, insert, update, delete on communities, memberships, users, categories to ${probeRole};
    grant insert on outbox to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await probePool.end();
  await close();
});

describe("createCommunityWithOwner", () => {
  it("creates the community and its active owner membership together", async () => {
    const ownerUserId = await insertUser(db);
    const slug = uniqueSlug("owned");

    const result = await createCommunityWithOwner(probeDb, {
      ownerUserId,
      slug,
      name: "Owned",
      description: "A place",
      privacy: "public",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.community).toMatchObject({ slug, name: "Owned", privacy: "public" });
    expect(result.membership).toMatchObject({
      communityId: result.community.id,
      userId: ownerUserId,
      role: "owner",
      status: "active",
    });
    expect(result.membership.joinedAt).toBeInstanceOf(Date);
    const created = await db
      .select({ slug: categories.slug, staffOnly: categories.staffOnly })
      .from(categories)
      .where(eq(categories.communityId, result.community.id))
      .orderBy(categories.position);
    expect(created).toEqual([
      { slug: "general", staffOnly: false },
      { slug: "introductions", staffOnly: false },
      { slug: "announcements", staffOnly: true },
    ]);
  });

  it("reports a taken slug and writes nothing", async () => {
    const slug = uniqueSlug("taken");
    await createCommunity(db, { slug, name: "First" });
    const ownerUserId = await insertUser(db);

    const result = await createCommunityWithOwner(probeDb, { ownerUserId, slug, name: "Second" });

    expect(result).toEqual({ kind: "slug_taken" });
    const rows = await db
      .select()
      .from(memberships)
      .where(sql`${memberships.userId} = ${ownerUserId}`);
    expect(rows).toEqual([]);
  });

  it("treats slugs case insensitively", async () => {
    const slug = uniqueSlug("case");
    await createCommunity(db, { slug, name: "Lower" });
    const ownerUserId = await insertUser(db);

    const result = await createCommunityWithOwner(probeDb, {
      ownerUserId,
      slug: slug.toUpperCase() as typeof slug,
      name: "Upper",
    });

    expect(result).toEqual({ kind: "slug_taken" });
  });
});

describe("community lookups", () => {
  it("finds a community by id and by slug as a non bypass role", async () => {
    const slug = uniqueSlug("lookup");
    const created = await createCommunity(probeDb, { slug, name: "Lookup" });

    expect((await getCommunityById(probeDb, created.id))?.slug).toBe(slug);
    expect((await getCommunityBySlug(probeDb, slug))?.id).toBe(created.id);
  });

  it("returns null for an unknown id", async () => {
    expect(await getCommunityById(db, parseCommunityId(newId()))).toBeNull();
  });
});

describe("communities row level security", () => {
  it("is enabled and forced", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'communities'`,
    );

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("rejects an insert whose id does not match app.community_id", async () => {
    await expect(
      probeDb.insert(communities).values({ slug: uniqueSlug("rogue"), name: "Rogue" }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("updates nothing without app.community_id", async () => {
    const created = await createCommunity(db, { slug: uniqueSlug("frozen"), name: "Frozen" });

    const updated = await probeDb
      .update(communities)
      .set({ name: "Changed" })
      .where(sql`${communities.id} = ${created.id}`)
      .returning();

    expect(updated).toEqual([]);
  });
});

describe("memberships", () => {
  it("inserts a membership once and returns the existing one after", async () => {
    const community = await createCommunity(db, { slug: uniqueSlug("join"), name: "Join" });
    const scope = withCommunity(probeDb, community.id);
    const userId = await insertUser(db);

    const first = await insertMembershipIfAbsent(scope, { userId, status: "active" });
    const second = await insertMembershipIfAbsent(scope, { userId, status: "active" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.membership.id).toBe(first.membership.id);
  });

  it("reads a membership in any status only within its community", async () => {
    const a = await createCommunity(db, { slug: uniqueSlug("sa"), name: "A" });
    const b = await createCommunity(db, { slug: uniqueSlug("sb"), name: "B" });
    const userId = await insertUser(db);
    await insertMembershipIfAbsent(withCommunity(probeDb, a.id), { userId, status: "pending" });

    expect((await getMembership(withCommunity(probeDb, a.id), userId))?.status).toBe("pending");
    expect(await getMembership(withCommunity(probeDb, b.id), userId)).toBeNull();
  });

  it("changes a membership status", async () => {
    const community = await createCommunity(db, { slug: uniqueSlug("st"), name: "St" });
    const scope = withCommunity(probeDb, community.id);
    const userId = await insertUser(db);
    await insertMembershipIfAbsent(scope, { userId, status: "active" });

    const updated = await setMembershipStatus(scope, userId, "removed");

    expect(updated?.status).toBe("removed");
  });

  it("lists the active communities of one user across tenants and nobody else's", async () => {
    const userId = await insertUser(db);
    const other = await insertUser(db);
    const a = await createCommunity(db, { slug: uniqueSlug("la"), name: "A" });
    const b = await createCommunity(db, { slug: uniqueSlug("lb"), name: "B" });
    const c = await createCommunity(db, { slug: uniqueSlug("lc"), name: "C" });
    await insertMembershipIfAbsent(withCommunity(db, a.id), { userId, status: "active" });
    await insertMembershipIfAbsent(withCommunity(db, b.id), {
      userId,
      status: "active",
      role: "admin",
    });
    await insertMembershipIfAbsent(withCommunity(db, c.id), { userId, status: "removed" });
    await insertMembershipIfAbsent(withCommunity(db, a.id), { userId: other, status: "active" });

    const rows = await listCommunitiesForUser(probeDb, userId);

    expect(rows.map((r) => r.community.id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.every((r) => r.membership.userId === userId)).toBe(true);
  });

  it("shows no memberships to a non bypass role with neither setting", async () => {
    const userId = await insertUser(db);
    const a = await createCommunity(db, { slug: uniqueSlug("none"), name: "None" });
    await insertMembershipIfAbsent(withCommunity(db, a.id), { userId, status: "active" });

    expect(await probeDb.select().from(memberships)).toEqual([]);
  });
});

describe("membership removal reason", () => {
  async function activeMember(): Promise<{
    scope: ReturnType<typeof withCommunity>;
    userId: string;
  }> {
    const community = await createCommunity(db, { slug: uniqueSlug("rr"), name: "Rr" });
    const scope = withCommunity(probeDb, community.id);
    const userId = await insertUser(db);
    await insertMembershipIfAbsent(scope, { userId, status: "active" });
    return { scope, userId };
  }

  it("records that a member left on their own", async () => {
    const { scope, userId } = await activeMember();

    const left = await leaveMembership(scope, userId);

    expect(left).toMatchObject({ status: "removed", removalReason: "left" });
  });

  it("records a removal by staff", async () => {
    const { scope, userId } = await activeMember();

    await db.transaction(async (tx) => {
      await setMemberRemovalReason(tx, "removed");
      await tx.update(memberships).set({ status: "removed" }).where(eq(memberships.userId, userId));
    });

    expect((await getMembership(scope, userId))?.removalReason).toBe("removed");
  });

  it("leaves the reason empty for a removal with no stated reason", async () => {
    const { scope, userId } = await activeMember();

    const removed = await setMembershipStatus(scope, userId, "removed");

    expect(removed).toMatchObject({ status: "removed", removalReason: null });
  });

  it("clears the reason when the member becomes active or banned again", async () => {
    const { scope, userId } = await activeMember();
    await leaveMembership(scope, userId);

    expect((await setMembershipStatus(scope, userId, "active"))?.removalReason).toBeNull();
    await leaveMembership(scope, userId);
    expect((await setMembershipStatus(scope, userId, "banned"))?.removalReason).toBeNull();
    expect((await setMembershipStatus(scope, userId, "removed"))?.removalReason).toBeNull();
  });

  it("restores only a membership its member left", async () => {
    const left = await activeMember();
    const removed = await activeMember();
    const at = new Date("2026-10-21T09:00:00.000Z");
    await leaveMembership(left.scope, left.userId);
    await setMembershipStatus(removed.scope, removed.userId, "removed");

    const restored = await restoreLeftMembership(left.scope, left.userId, at);
    const refused = await restoreLeftMembership(removed.scope, removed.userId, at);

    expect(restored).toMatchObject({ status: "active", removalReason: null, joinedAt: at });
    expect(refused).toBeNull();
    expect((await getMembership(removed.scope, removed.userId))?.status).toBe("removed");
  });

  it("does not restore a membership in another community", async () => {
    const left = await activeMember();
    const other = await createCommunity(db, { slug: uniqueSlug("rx"), name: "Rx" });
    await leaveMembership(left.scope, left.userId);

    const restored = await restoreLeftMembership(
      withCommunity(probeDb, other.id),
      left.userId,
      new Date(),
    );

    expect(restored).toBeNull();
    expect((await getMembership(left.scope, left.userId))?.status).toBe("removed");
  });
});
