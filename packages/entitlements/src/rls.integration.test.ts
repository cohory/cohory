import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  rlsSettingName,
  withCommunity,
  type CommunityId,
  type Transaction,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  agentIdentities,
  agentSubmissions,
  courseAgentSettings,
  courseDelegations,
  courses,
  users,
} from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const probeRole = "cohory_entitlements_rls_probe";
const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const tables = ["course_agent_settings", "course_delegations", "agent_submissions"] as const;

interface Tenant {
  communityId: CommunityId;
  userId: string;
  courseId: string;
  agentId: string;
}

let a: Tenant;
let b: Tenant;

async function asProbe<T>(
  settings: Record<string, string>,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${probeRole}`));
    for (const [name, value] of Object.entries(settings)) {
      await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    }
    return fn(tx);
  });
}

async function tenant(label: string): Promise<Tenant> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`rls-ent-${label}-${newId().slice(-12)}`),
    name: label,
  });
  const [user] = await db
    .insert(users)
    .values({ name: label, email: `rls-ent-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  await addMembership(withCommunity(db, community.id), {
    userId: user.id,
    role: "member",
    status: "active",
  });
  const courseId = newId();
  const agentId = newId();
  await db.insert(courses).values({
    id: courseId,
    communityId: community.id,
    slug: `rls-${courseId.slice(-12)}`,
    title: label,
    position: 0,
  });
  await db.insert(agentIdentities).values({
    id: agentId,
    communityId: community.id,
    ownerId: user.id,
    name: label,
    createdBy: user.id,
  });
  await db.insert(courseAgentSettings).values({
    courseId,
    communityId: community.id,
    allowAgentAccess: true,
  });
  const [delegation] = await db
    .insert(courseDelegations)
    .values({ communityId: community.id, courseId, humanId: user.id, agentId })
    .returning({ id: courseDelegations.id });
  await db.insert(agentSubmissions).values({
    communityId: community.id,
    courseId,
    lessonId: "l1",
    taskId: "t1",
    version: "1.0.0",
    agentId,
    humanId: user.id,
    delegationId: delegation?.id ?? null,
    runId: "run",
    payload: { ok: true },
  });
  return { communityId: community.id, userId: user.id, courseId, agentId };
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
    grant select, insert, update, delete on ${tables.join(", ")} to ${probeRole};
  `),
  );
  a = await tenant("a");
  b = await tenant("b");
});

afterAll(async () => {
  await pool.end();
});

describe("row level security on delegation tables", () => {
  it.each(tables)("is enabled and forced on %s", async (table) => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`,
    );
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("returns no rows without a community setting", async () => {
    const counts = await asProbe({}, async (tx) => [
      (await tx.select().from(courseAgentSettings)).length,
      (await tx.select().from(courseDelegations)).length,
      (await tx.select().from(agentSubmissions)).length,
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });

  it("returns only rows of the community in app.community_id", async () => {
    const rows = await asProbe({ "app.community_id": a.communityId }, async (tx) => ({
      settings: await tx.select().from(courseAgentSettings),
      delegations: await tx.select().from(courseDelegations),
      submissions: await tx.select().from(agentSubmissions),
    }));
    expect(rows.settings.map((row) => row.courseId)).toEqual([a.courseId]);
    expect(rows.delegations.map((row) => row.courseId)).toEqual([a.courseId]);
    expect(rows.submissions.map((row) => row.courseId)).toEqual([a.courseId]);
  });

  it("lets the delegation job read every community but keeps submissions closed", async () => {
    const rows = await asProbe({ [rlsSettingName("delegation_jobs")]: "on" }, async (tx) => ({
      delegations: await tx.select().from(courseDelegations),
      submissions: await tx.select().from(agentSubmissions),
    }));
    const communities = new Set(rows.delegations.map((row) => row.communityId));
    expect(communities.has(a.communityId) && communities.has(b.communityId)).toBe(true);
    expect(rows.submissions).toEqual([]);
  });

  it("refuses to write a delegation into another community", async () => {
    await expect(
      asProbe({ "app.community_id": a.communityId }, (tx) =>
        tx.insert(courseDelegations).values({
          communityId: b.communityId,
          courseId: b.courseId,
          humanId: a.userId,
          agentId: a.agentId,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("refuses a course from another community through the composite key", async () => {
    await expect(
      db.insert(courseDelegations).values({
        communityId: a.communityId,
        courseId: b.courseId,
        humanId: a.userId,
        agentId: a.agentId,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
