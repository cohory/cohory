import { createPool, parseAdminDatabaseEnv } from "../index";
import { runMigrations } from "../migrations";
import { assertTestDatabase, ensureTestDatabase } from "../test-database";

export default async function setup(): Promise<void> {
  const env = parseAdminDatabaseEnv();
  assertTestDatabase(env.DATABASE_URL, process.env);
  assertTestDatabase(env.DATABASE_ADMIN_URL, process.env);
  await ensureTestDatabase(env.DATABASE_ADMIN_URL);
  const pool = createPool(env.DATABASE_ADMIN_URL);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
