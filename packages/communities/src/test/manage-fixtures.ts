import type { Actor } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  runInCommunity,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { memberships, users, type MemberRole, type MemberStatus } from "@cohory/db/schema";
import type { FairUseConfig } from "@cohory/fair-use";
import {
  imageVariantWidths,
  type ImageProcessor,
  type PutObjectInput,
  type StorageKey,
} from "@cohory/storage";
import { sql } from "drizzle-orm";

import type { BrandingStorage } from "../manage/context";
import { prepareCommunityDeletion } from "@cohory/payments";

import type { MemberAccessPort } from "../manage/member-access";
import type { PaidExitPort } from "../manage/paid-exit";
import { createPostgresManageRepository } from "../manage/postgres-repository";
import { createManageService, type ManageService } from "../manage/service";
import type { VideoThumbnailResolver } from "../manage/video-thumbnail";

export const manageProbeRole = "cohory_manage_probe";

export const unpaidExit: PaidExitPort = {
  beginArchive: async () => {},
  beginDeletion: async () => ({ kind: "ready" }),
  deletionReady: async () => true,
  prepareDeletion: async (queries, input) =>
    (await prepareCommunityDeletion(queries, input)).kind === "detached",
  endMemberBilling: async () => {},
};

export const noMemberAccess: MemberAccessPort = {
  list: async () => new Map(),
};

export type UserActor = Extract<Actor, { kind: "user" }>;

export interface ManageHarness {
  readonly admin: Database;
  readonly app: Database;
  readonly service: ManageService;
  readonly storage: MemoryStorage;
  close(): Promise<void>;
}

export interface MemoryStorage extends BrandingStorage {
  readonly objects: Map<string, PutObjectInput>;
  readonly deleted: string[];
}

export const cleanedImage = new Uint8Array([0x63, 0x6c, 0x65, 0x61, 0x6e]);

export function fakeImageProcessor(
  variantBytes: (width: number) => number = (width) => width / 10,
  during: () => Promise<void> = async () => undefined,
): ImageProcessor {
  return async () => {
    await during();
    return {
      original: cleanedImage,
      variants: imageVariantWidths.map((width) => ({
        width,
        body: new Uint8Array(variantBytes(width)),
      })),
    };
  };
}

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, PutObjectInput>();
  const deleted: string[] = [];
  return {
    objects,
    deleted,
    async put(input) {
      objects.set(input.key, input);
      return { key: input.key, contentType: "image/png", size: input.body.byteLength };
    },
    async delete(key: StorageKey) {
      objects.delete(key);
      deleted.push(key);
    },
    publicUrl: (key) => `/api/uploads/${key}`,
    async usedBytes(prefix) {
      let total = 0;
      for (const [key, object] of objects) {
        if (key.startsWith(prefix)) {
          total += object.body.byteLength;
        }
      }
      return total;
    },
  };
}

async function ensureProbeRole(admin: Database): Promise<void> {
  await admin.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${manageProbeRole}') then
          create role ${manageProbeRole} nologin nosuperuser nobypassrls;
        end if;
      end $$`),
    );
    await tx.execute(sql.raw(`grant usage on schema public to ${manageProbeRole}`));
    await tx.execute(
      sql.raw(
        `grant select, insert, update, delete on all tables in schema public to ${manageProbeRole}`,
      ),
    );
  });
}

export function openPool(role?: string): { db: Database; close: () => Promise<void> } {
  const url = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  if (role) {
    url.searchParams.set("options", `-c role=${role}`);
  }
  const pool = createPool(url.toString());
  return { db: createDb(pool), close: () => pool.end() };
}

export async function openManageHarness(
  options: {
    now?: () => Date;
    fairUse?: FairUseConfig;
    rateLimit?: (rule: "joinRequest", key: string) => void;
    videoThumbnail?: VideoThumbnailResolver;
    paidExit?: PaidExitPort;
    memberAccess?: MemberAccessPort;
    processImage?: ImageProcessor;
  } = {},
): Promise<ManageHarness> {
  const admin = openPool();
  await ensureProbeRole(admin.db);
  const app = openPool(manageProbeRole);
  const storage = createMemoryStorage();
  const service = createManageService({
    repo: createPostgresManageRepository(app.db),
    storage,
    ...(options.now ? { now: options.now } : {}),
    ...(options.fairUse ? { fairUse: options.fairUse } : {}),
    ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    videoThumbnail: options.videoThumbnail ?? (async () => null),
    paidExit: options.paidExit ?? unpaidExit,
    memberAccess: options.memberAccess ?? noMemberAccess,
    processImage: options.processImage ?? null,
  });
  return {
    admin: admin.db,
    app: app.db,
    service,
    storage,
    async close() {
      await app.close();
      await admin.close();
    },
  };
}

export function asUser(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

export async function insertUser(
  db: Database,
  name = "Person",
  email = `person-${newId()}@example.test`,
): Promise<UserActor> {
  const [row] = await db
    .insert(users)
    .values({ name, email, username: `u-${newId().slice(-12)}` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return asUser(row.id);
}

export async function insertCommunity(
  db: Database,
  privacy: "public" | "private" = "private",
): Promise<{ id: CommunityId; slug: string }> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`manage-${newId().slice(-12)}`),
    name: "Manage",
    privacy,
  });
  return { id: community.id, slug: community.slug };
}

export async function insertMember(
  db: Database,
  communityId: CommunityId,
  role: MemberRole = "member",
  status: MemberStatus = "active",
  name = "Person",
): Promise<UserActor> {
  const actor = await insertUser(db, name);
  await addMembership(withCommunity(db, communityId), {
    userId: actor.userId,
    role,
    status,
    joinedAt: new Date(),
  });
  return actor;
}

export async function insertMembers(
  db: Database,
  communityId: CommunityId,
  count: number,
): Promise<void> {
  const rows = await db
    .insert(users)
    .values(
      Array.from({ length: count }, () => ({
        name: "Person",
        email: `person-${newId()}@example.test`,
        username: `u-${newId().slice(-12)}`,
      })),
    )
    .returning({ id: users.id });
  const joinedAt = new Date();
  const role: MemberRole = "member";
  const status: MemberStatus = "active";
  await runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
    await tx
      .insert(memberships)
      .values(rows.map((row) => values({ userId: row.id, role, status, joinedAt })));
  });
}

export interface Cast {
  readonly communityId: CommunityId;
  readonly slug: string;
  readonly owner: UserActor;
  readonly admin: UserActor;
  readonly moderator: UserActor;
  readonly member: UserActor;
  readonly outsider: UserActor;
}

export async function insertCast(
  db: Database,
  privacy: "public" | "private" = "private",
): Promise<Cast> {
  const { id, slug } = await insertCommunity(db, privacy);
  return {
    communityId: id,
    slug,
    owner: await insertMember(db, id, "owner", "active", "Owner"),
    admin: await insertMember(db, id, "admin", "active", "Admin"),
    moderator: await insertMember(db, id, "moderator", "active", "Moderator"),
    member: await insertMember(db, id, "member", "active", "Member"),
    outsider: await insertUser(db, "Outsider"),
  };
}

export async function auditActions(db: Database, communityId: string): Promise<string[]> {
  const result = await db.execute<{ action: string }>(
    sql`select action from audit_log where community_id = ${communityId} order by created_at, id`,
  );
  return result.rows.map((row) => row.action);
}
