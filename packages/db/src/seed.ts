import { createDb, createPool } from "./client";
import { parseAdminDatabaseEnv } from "./env";
import { seedDevData } from "./seed/dev-data";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "the dev seed creates accounts with a known password and never runs in production",
    );
  }
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  try {
    const result = await seedDevData(createDb(pool));
    console.info(JSON.stringify({ level: "info", msg: "seed applied", ...result }));
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
