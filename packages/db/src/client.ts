import "#server-only";

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { parseDatabaseEnv, parsePoolEnv, type PoolEnv, type PoolRole } from "./env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export type PoolSettings = Omit<PoolEnv, "queueMax">;

let poolRole: PoolRole = "web";

export function setPoolRole(role: PoolRole): void {
  poolRole = role;
}

function poolEnv(): PoolEnv {
  return parsePoolEnv(process.env, poolRole);
}

export function createPool(connectionString: string, settings: PoolSettings = poolEnv()): Pool {
  return new Pool({
    connectionString,
    max: settings.max,
    connectionTimeoutMillis: settings.connectionTimeoutMs,
    statement_timeout: settings.statementTimeoutMs,
    idle_in_transaction_session_timeout: settings.idleInTransactionTimeoutMs,
  });
}

export function createQueuePool(connectionString: string, settings: PoolEnv = poolEnv()): Pool {
  return createPool(connectionString, { ...settings, max: settings.queueMax });
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}

let defaultDb: Database | undefined;

export function getDb(): Database {
  defaultDb ??= createDb(createPool(parseDatabaseEnv().DATABASE_URL));
  return defaultDb;
}

export async function pingDatabase(db: Database = getDb()): Promise<void> {
  await db.execute(sql`select 1`);
}

export interface QueueDatabase {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

let queueDb: QueueDatabase | undefined;

// Every pg-boss sender in one process shares this small pool, so queueing jobs from several
// modules cannot open a full sized pool per module.
export function getQueueDatabase(): QueueDatabase {
  if (!queueDb) {
    const pool = createQueuePool(parseDatabaseEnv().DATABASE_URL);
    queueDb = { executeSql: (text, values) => pool.query(text, values) };
  }
  return queueDb;
}
