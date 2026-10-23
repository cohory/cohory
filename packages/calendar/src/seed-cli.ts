import { createDb, createPool, parseAdminDatabaseEnv } from "@cohory/db";

import { seedDevEvents } from "./seed";

async function main(): Promise<void> {
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  try {
    const result = await seedDevEvents(createDb(pool));
    console.info(JSON.stringify({ level: "info", msg: "calendar seed applied", ...result }));
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
