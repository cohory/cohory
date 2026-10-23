import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { communities, users, type MemberRole } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";

export const probeRole = "cohory_reviews_probe";

const probeTables = [
  "communities",
  "memberships",
  "users",
  "outbox",
  "audit_log",
  "notifications",
  "reviews",
  "review_replies",
  "review_reports",
];

export function openTestDb(options: { role?: string } = {}): {
  db: Database;
  close: () => Promise<void>;
} {
  const url = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  if (options.role) {
    url.searchParams.set("options", `-c role=${options.role}`);
  }
  const pool = createPool(url.toString());
  return { db: createDb(pool), close: () => pool.end() };
}

export async function openProbeDb(
  admin: Database,
): Promise<{ db: Database; close: () => Promise<void> }> {
  await admin.transaction(async (tx) => {
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
  return openTestDb({ role: probeRole });
}

export async function insertUser(db: Database, name = "Test User"): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ name, email: `user-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!user) {
    throw new Error("user insert returned no row");
  }
  return user.id;
}

export async function insertCommunity(
  db: Database,
  options: { reviewsEnabled?: boolean; privacy?: "public" | "private" } = {},
): Promise<CommunityId> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`rev-${newId().slice(-12)}`),
    name: "Reviews",
    privacy: options.privacy ?? "private",
  });
  await db
    .update(communities)
    .set({ reviewsEnabled: options.reviewsEnabled ?? true })
    .where(eq(communities.id, community.id));
  return community.id;
}

export async function insertMember(
  db: Database,
  communityId: CommunityId,
  options: { name?: string; role?: MemberRole } = {},
): Promise<string> {
  const userId = await insertUser(db, options.name);
  await addMembership(withCommunity(db, communityId), {
    userId,
    role: options.role ?? "member",
    status: "active",
    joinedAt: new Date(),
  });
  return userId;
}
