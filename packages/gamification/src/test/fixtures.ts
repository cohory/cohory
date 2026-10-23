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
import { communities, users, type MemberRole } from "@cohory/db/schema";
import { eq } from "drizzle-orm";

export function openTestDb(): { db: Database; close: () => Promise<void> } {
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  return { db: createDb(pool), close: () => pool.end() };
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
  options: {
    gamificationEnabled?: boolean;
    levelNames?: string[];
    privacy?: "public" | "private";
  } = {},
): Promise<CommunityId> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`gam-${newId().slice(-12)}`),
    name: "Gamification",
    privacy: options.privacy ?? "private",
  });
  if (options.gamificationEnabled === false || options.levelNames) {
    await db
      .update(communities)
      .set({
        gamificationEnabled: options.gamificationEnabled ?? true,
        ...(options.levelNames ? { levelNames: options.levelNames } : {}),
      })
      .where(eq(communities.id, community.id));
  }
  return community.id;
}

export async function insertMember(
  db: Database,
  communityId: CommunityId,
  options: { name?: string; role?: MemberRole; status?: "active" | "removed" } = {},
): Promise<string> {
  const userId = await insertUser(db, options.name);
  await addMembership(withCommunity(db, communityId), {
    userId,
    role: options.role ?? "member",
    status: options.status ?? "active",
    joinedAt: new Date(),
  });
  return userId;
}
