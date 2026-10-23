import type { Actor } from "@cohory/authz";
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
import { users, type MemberRole } from "@cohory/db/schema";

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

export function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

export async function insertUser(db: Database, name = "Attendee"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `attendee-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return row.id;
}

export async function insertCommunity(
  db: Database,
  privacy: "public" | "private" = "private",
): Promise<CommunityId> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`calendar-${newId().slice(-12)}`),
    name: "Calendar",
    privacy,
  });
  return community.id;
}

export async function insertMember(
  db: Database,
  communityId: CommunityId,
  role: MemberRole = "member",
): Promise<string> {
  const userId = await insertUser(db);
  await addMembership(withCommunity(db, communityId), {
    userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return userId;
}

export const probeRole = "cohory_calendar_probe";
