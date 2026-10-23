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
import { users, type MemberRole, type MemberStatus } from "@cohory/db/schema";
import { migrationLockKey } from "@cohory/db/migrations";
import { sql } from "drizzle-orm";

import type { PaymentsEnv } from "../config";
import { createKeyring } from "../crypto";

export const probeRole = "cohory_payments_probe";

const probeTables = [
  "communities",
  "memberships",
  "outbox",
  "users",
  "sessions",
  "payment_connections",
  "membership_plans",
  "payment_customers",
  "subscriptions",
  "payments",
  "fee_ledger_entries",
  "provider_events",
  "comped_memberships",
  "comp_invitations",
  "subscription_links",
  "audit_log",
  "payment_exit_runs",
  "platform_billing_accounts",
  "platform_invoices",
  "platform_invoice_lines",
  "pending_join_answers",
  "membership_holds",
  "invite_links",
  "posts",
  "lesson_progress",
  "event_rsvps",
  "event_occurrences",
  "creator_terms_acceptances",
  "subscriber_moves",
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

export function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

export async function insertUser(db: Database, name = "Buyer"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `buyer-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return row.id;
}

export async function insertCommunity(
  db: Database,
  privacy: "public" | "private" = "public",
): Promise<CommunityId> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`pay-${newId().slice(-12)}`),
    name: "Paid circle",
    privacy,
  });
  return community.id;
}

export async function insertMember(
  db: Database,
  communityId: CommunityId,
  role: MemberRole = "member",
  status: MemberStatus = "active",
): Promise<string> {
  const userId = await insertUser(db);
  await addMembership(withCommunity(db, communityId), {
    userId,
    role,
    status,
    joinedAt: new Date(),
  });
  return userId;
}

export const encryptionKey = Buffer.alloc(32, 9);

export function cloudEnv(overrides: Partial<PaymentsEnv> = {}): PaymentsEnv {
  return {
    edition: "cloud",
    platformFeeBps: 200,
    nodeEnv: "test",
    stripeSecretKey: "sk_test_platform",
    webhookSecrets: ["whsec_platform", "whsec_connect"],
    encryptionKeys: createKeyring([encryptionKey]),
    appUrl: "http://localhost:3000",
    stripeApiBaseUrl: null,
    polarApiBaseUrl: null,
    connectClientId: null,
    polarEnabled: true,
    creatorTermsVersion: "1",
    subscriptionLinking: false,
    ...overrides,
  };
}

export function communityEnv(overrides: Partial<PaymentsEnv> = {}): PaymentsEnv {
  return cloudEnv({
    edition: "community",
    stripeSecretKey: null,
    webhookSecrets: [],
    subscriptionLinking: true,
    ...overrides,
  });
}
