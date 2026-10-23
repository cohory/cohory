import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDb, createPool, newId, parseAdminDatabaseEnv, type Database } from "@cohory/db";
import { migrationLockKey, runMigrations } from "@cohory/db/migrations";
import { createOptOutLinker, type EmailMessage, type Mailer } from "@cohory/email";
import { createLocalDriver, type StorageDriver } from "@cohory/storage";

import type {
  MigrationEnqueueOptions,
  MigrationJobName,
  MigrationJobPayload,
  MigrationQueue,
} from "../jobs";
import { createRuntime, type MigrationDeps, type Runtime } from "../runtime";

export const probeRole = "cohory_migration_probe";

export interface TestDatabase {
  readonly name: string;
  readonly admin: Database;
  readonly probe: Database;
  close(): Promise<void>;
}

function urlFor(database: string, role?: string): string {
  const url = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  url.pathname = `/${database}`;
  if (role) {
    url.searchParams.set("options", `-c role=${role}`);
  }
  return url.toString();
}

export function currentDatabaseName(): string {
  return new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL).pathname.slice(1);
}

async function grantProbe(pool: ReturnType<typeof createPool>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [migrationLockKey]);
    await client.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$`);
    await client.query(`grant usage on schema public to ${probeRole}`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema public to ${probeRole}`,
    );
    await client.query("commit");
  } catch (error: unknown) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function openDatabase(name: string): Promise<TestDatabase> {
  const adminPool = createPool(urlFor(name));
  await grantProbe(adminPool);
  const probePool = createPool(urlFor(name, probeRole));
  return {
    name,
    admin: createDb(adminPool),
    probe: createDb(probePool),
    async close() {
      await probePool.end();
      await adminPool.end();
    },
  };
}

export async function createScratchDatabase(prefix: string): Promise<TestDatabase> {
  const name = `${prefix}_${newId().replaceAll("-", "").slice(-16)}`;
  const root = createPool(urlFor(currentDatabaseName()));
  try {
    await root.query(`create database ${name}`);
  } finally {
    await root.end();
  }
  const pool = createPool(urlFor(name));
  try {
    await pool.query("create extension if not exists citext");
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  const database = await openDatabase(name);
  return {
    ...database,
    async close() {
      await database.close();
      const cleanup = createPool(urlFor(currentDatabaseName()));
      try {
        await cleanup.query(`drop database if exists ${name} with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export interface TempStorage {
  readonly driver: StorageDriver;
  remove(): Promise<void>;
}

export async function tempStorage(maxBytes = 50 * 1024 * 1024): Promise<TempStorage> {
  const root = await mkdtemp(path.join(tmpdir(), "cohory-migration-"));
  return {
    driver: createLocalDriver({ root, maxBytes }),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

export class RecordingQueue implements MigrationQueue {
  readonly sent: {
    name: MigrationJobName;
    payload: MigrationJobPayload;
    startAfter?: Date;
  }[] = [];

  enqueue(
    name: MigrationJobName,
    payload: MigrationJobPayload,
    options: MigrationEnqueueOptions = {},
  ): Promise<void> {
    this.sent.push({
      name,
      payload,
      ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    });
    return Promise.resolve();
  }
}

export class RecordingMailer implements Mailer {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly deps: MigrationDeps;
  readonly queue: RecordingQueue;
  readonly mailer: RecordingMailer;
}

export function testRuntime(
  db: Database,
  storage: { archives: StorageDriver; content: StorageDriver },
  edition: "community" | "cloud" = "community",
): TestRuntime {
  const queue = new RecordingQueue();
  const mailer = new RecordingMailer();
  const deps: MigrationDeps = {
    db,
    archiveStorage: storage.archives,
    contentStorage: storage.content,
    queue,
    mailer,
    optOut: createOptOutLinker({
      secret: "migration-test-secret-".padEnd(32, "x"),
      appUrl: "https://new.example.test",
    }),
    config: { archiveMaxBytes: 50 * 1024 * 1024, appUrl: "https://new.example.test" },
    fairUse: {
      edition,
      free: { members: null, storageBytes: null, uploadBytes: null },
      paid: { members: null, storageBytes: null, uploadBytes: null },
    },
  };
  return { runtime: createRuntime(deps), deps, queue, mailer };
}
