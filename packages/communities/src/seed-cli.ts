import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, createPool, parseAdminDatabaseEnv } from "@cohory/db";
import { createStorage, parseStorageEnv, type StorageEnv } from "@cohory/storage";

import { seedDevCommunity } from "./seed";

const webAppRoot = fileURLToPath(new URL("../../../apps/web/", import.meta.url));

function storageEnvLikeTheWebApp(env: StorageEnv): StorageEnv {
  if (env.STORAGE_DRIVER !== "local" || path.isAbsolute(env.STORAGE_LOCAL_PATH)) {
    return env;
  }
  return { ...env, STORAGE_LOCAL_PATH: path.resolve(webAppRoot, env.STORAGE_LOCAL_PATH) };
}

async function main(): Promise<void> {
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  try {
    const storage = createStorage(storageEnvLikeTheWebApp(parseStorageEnv()));
    const result = await seedDevCommunity(createDb(pool), storage);
    console.info(JSON.stringify({ level: "info", msg: "community seed applied", ...result }));
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
