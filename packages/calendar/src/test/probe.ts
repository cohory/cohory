import type { Database } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { sql } from "drizzle-orm";

import { openTestDb, probeRole } from "./fixtures";

const probeTables = [
  "communities",
  "memberships",
  "outbox",
  "users",
  "events",
  "event_occurrences",
  "event_rsvps",
];

const paidAccessTables = [
  "subscriptions",
  "payment_connections",
  "comped_memberships",
  "membership_plans",
];

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
        if not has_table_privilege('${probeRole}', 'event_rsvps', 'update') then
          grant usage on schema public to ${probeRole};
          grant select, insert, update, delete on ${probeTables.join(", ")} to ${probeRole};
        end if;
        grant select on ${paidAccessTables.join(", ")} to ${probeRole};
      end $$`),
    );
  });
  return openTestDb({ role: probeRole });
}
