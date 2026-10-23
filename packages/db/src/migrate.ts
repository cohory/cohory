import { appRoleFromUrls, ensureAppRole } from "./app-role";
import { createPool } from "./client";
import { parseAdminDatabaseEnv, parsePoolEnv } from "./env";
import { migrationsFolder, runMigrations } from "./migrations";

const migrationLockTimeoutMs = 10_000;

async function main(): Promise<void> {
  const env = parseAdminDatabaseEnv();
  const pool = createPool(env.DATABASE_ADMIN_URL, {
    ...parsePoolEnv(),
    statementTimeoutMs: 0,
    idleInTransactionTimeoutMs: 0,
  });
  try {
    await runMigrations(pool, { lockTimeoutMs: migrationLockTimeoutMs });
    console.info(JSON.stringify({ level: "info", msg: "migrations applied", migrationsFolder }));
    const appRole = appRoleFromUrls(env.DATABASE_URL, env.DATABASE_ADMIN_URL);
    if (appRole) {
      await ensureAppRole(pool, appRole);
      console.info(JSON.stringify({ level: "info", msg: "app role ensured", role: appRole.name }));
    }
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
