import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export const migrationLockKey = 727_001;

export interface MigrationOptions {
  readonly lockTimeoutMs?: number;
}

export async function runMigrations(pool: Pool, options: MigrationOptions = {}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [migrationLockKey]);
    try {
      // Set only after the advisory lock so a second runner still waits for the first one.
      if (options.lockTimeoutMs !== undefined) {
        await client.query(`set lock_timeout = ${Math.trunc(options.lockTimeoutMs)}`);
      }
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      try {
        await client.query("select pg_advisory_unlock($1)", [migrationLockKey]);
      } finally {
        await client.query("reset lock_timeout");
      }
    }
  } finally {
    client.release();
  }
}
