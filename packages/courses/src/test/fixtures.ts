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
import {
  contentTypeForKey,
  type PutObjectInput,
  type StorageKey,
  type StoredObject,
  type StoredObjectInfo,
} from "@cohory/storage";

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

export async function insertUser(db: Database, name = "Learner"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `learner-${newId()}@example.test` })
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
    slug: communitySlugSchema.parse(`courses-${newId().slice(-12)}`),
    name: "Courses",
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

export function memoryStorage(): {
  put: (input: PutObjectInput) => Promise<StoredObjectInfo>;
  get: (key: StorageKey) => Promise<StoredObject | null>;
  objects: Map<string, PutObjectInput>;
} {
  const objects = new Map<string, PutObjectInput>();
  return {
    objects,
    put: async (input) => {
      objects.set(input.key, input);
      return { key: input.key, contentType: "application/pdf", size: input.body.byteLength };
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) return null;
      const contentType = contentTypeForKey(key);
      if (!contentType) return null;
      return {
        key,
        contentType,
        size: object.body.byteLength,
        body: new Blob([object.body]).stream(),
      };
    },
  };
}
