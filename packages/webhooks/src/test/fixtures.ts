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
import { migrationLockKey } from "@cohory/db/migrations";
import { users, type MemberRole } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { vi } from "vitest";

import type { DeliveryQueue } from "../queue";

export const probeRole = "cohory_webhooks_probe";
export const testKey = Buffer.alloc(32, 9);

export function openDb(role?: string): { db: Database; close: () => Promise<void> } {
  const url = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  if (role) {
    url.searchParams.set("options", `-c role=${role}`);
  }
  const pool = createPool(url.toString());
  return { db: createDb(pool), close: () => pool.end() };
}

export async function ensureProbeRole(admin: Database): Promise<void> {
  await admin.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
      end $$`),
    );
    await tx.execute(sql.raw(`grant usage on schema public to ${probeRole}`));
    await tx.execute(
      sql.raw(
        `grant select, insert, update, delete on all tables in schema public to ${probeRole}`,
      ),
    );
  });
}

export function actor(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

export async function insertUser(db: Database, label = "user"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: `Webhook ${label}`,
      email: `${label}-${newId()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return row.id;
}

export interface Community {
  readonly id: CommunityId;
  readonly slug: string;
  readonly members: Record<MemberRole, string>;
}

export async function seedCommunity(db: Database, prefix = "hooks"): Promise<Community> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`${prefix}-${newId().slice(-12)}`),
    name: "Webhook makers",
  });
  const members = {} as Record<MemberRole, string>;
  for (const role of ["owner", "admin", "moderator", "member"] as const) {
    const userId = await insertUser(db, role);
    await addMembership(withCommunity(db, community.id), {
      userId,
      role,
      status: "active",
      joinedAt: new Date(),
    });
    members[role] = userId;
  }
  return { id: community.id, slug: community.slug, members };
}

export function fakeQueue() {
  const enqueue = vi.fn<DeliveryQueue["enqueue"]>().mockResolvedValue(undefined);
  return { enqueue };
}
