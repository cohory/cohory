import { createDb, createPool, parseAdminDatabaseEnv, type Database } from "../index";
import { newId } from "../ids";
import { users } from "../schema";
import { communitySlugSchema, type CommunitySlug } from "../slug";

export function openTestDb(): { db: Database; close: () => Promise<void> } {
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  return { db: createDb(pool), close: () => pool.end() };
}

export function uniqueSlug(prefix: string): CommunitySlug {
  return communitySlugSchema.parse(`${prefix}-${newId().slice(-12)}`);
}

export async function insertUser(db: Database): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ name: "Test User", email: `user-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!user) {
    throw new Error("user insert returned no row");
  }
  return user.id;
}
