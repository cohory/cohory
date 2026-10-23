import { getDb } from "@cohory/db";
import {
  createOptOutLinker,
  getMailer,
  getSuppressionList,
  optOutSecretFromEnv,
} from "@cohory/email";
import { getFairUseConfig } from "@cohory/fair-use";
import { createStorage, getStorage, parseStorageEnv, type StorageDriver } from "@cohory/storage";

import { parseMigrationEnv } from "./config";
import { createPgBossMigrationQueue } from "./jobs-pg-boss";
import { createRuntime, type MigrationDeps, type Runtime } from "./runtime";
import { createMigrationService, type MigrationService } from "./service";

let archiveStorage: StorageDriver | undefined;

function getArchiveStorage(maxBytes: number): StorageDriver {
  archiveStorage ??= createStorage({ ...parseStorageEnv(), STORAGE_MAX_UPLOAD_BYTES: maxBytes });
  return archiveStorage;
}

export function defaultMigrationDeps(): MigrationDeps {
  const config = parseMigrationEnv();
  return {
    db: getDb(),
    archiveStorage: getArchiveStorage(config.archiveMaxBytes),
    contentStorage: getStorage(),
    queue: createPgBossMigrationQueue(),
    config,
    fairUse: getFairUseConfig(),
    mailer: getMailer(),
    optOut: createOptOutLinker({ secret: optOutSecretFromEnv(), appUrl: config.appUrl }),
    suppression: getSuppressionList(),
  };
}

let service: MigrationService | undefined;
let runtime: Runtime | undefined;

export function getMigrationService(): MigrationService {
  service ??= createMigrationService(defaultMigrationDeps());
  return service;
}

export function getMigrationRuntime(): Runtime {
  runtime ??= createRuntime(defaultMigrationDeps());
  return runtime;
}
