import { readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "./client";
import { parseAdminDatabaseEnv } from "./env";
import { describeRefusal, resetLocalRefusal } from "./reset-local-guard";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const webAppRoot = path.join(repoRoot, "apps/web");

async function dropSchemas(adminUrl: string): Promise<void> {
  const pool = createPool(adminUrl);
  try {
    await pool.query("drop schema if exists public, drizzle, pgboss cascade");
    await pool.query("create schema public");
  } finally {
    await pool.end();
  }
}

// The web app resolves a relative STORAGE_LOCAL_PATH from apps/web, so the seed and this reset do too.
function localUploadsFolder(env: NodeJS.ProcessEnv): string | null {
  if ((env.STORAGE_DRIVER ?? "local") !== "local" || !env.STORAGE_LOCAL_PATH) {
    return null;
  }
  const folder = path.resolve(webAppRoot, env.STORAGE_LOCAL_PATH);
  const unsafe = [path.parse(folder).root, homedir(), repoRoot, webAppRoot].map((p) =>
    path.resolve(p),
  );
  if (unsafe.includes(folder)) {
    throw new Error(`refusing to wipe ${folder}; point STORAGE_LOCAL_PATH at an uploads folder`);
  }
  return folder;
}

async function wipeUploads(folder: string): Promise<number> {
  const entries = await readdir(folder).catch(() => []);
  for (const entry of entries) {
    await rm(path.join(folder, entry), { recursive: true, force: true });
  }
  return entries.length;
}

async function main(): Promise<void> {
  const refusal = resetLocalRefusal(process.env, process.argv.slice(2));
  if (refusal) {
    throw new Error(describeRefusal(refusal));
  }
  const env = parseAdminDatabaseEnv();
  const uploads = localUploadsFolder(process.env);
  await dropSchemas(env.DATABASE_ADMIN_URL);
  const wiped = uploads ? await wipeUploads(uploads) : 0;
  console.info(
    JSON.stringify({ level: "info", msg: "local database reset", uploadsFolder: uploads, wiped }),
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
