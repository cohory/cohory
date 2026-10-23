import { createDb, createPool, parseAdminDatabaseEnv } from "@cohory/db";

import { seedDevPaidPosts, seedDevPosts } from "./seed";

async function main(): Promise<void> {
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  try {
    const db = createDb(pool);
    const creators = await seedDevPosts(db);
    const pro = await seedDevPaidPosts(db);
    console.info(JSON.stringify({ level: "info", msg: "posts seed applied", creators, pro }));
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
