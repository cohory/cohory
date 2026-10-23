import {
  migrationExportJob,
  migrationImportFinishedJob,
  migrationImportJob,
  migrationJobPayloadSchema,
  migrationMembersImportJob,
  type MigrationFilesExpiry,
  type MigrationJobName,
  type MigrationJobPayload,
  type RunOutcome,
} from "@cohory/migration";
import type { Job } from "pg-boss";

import { migrationQueueOptions } from "@cohory/migration";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const MIGRATION_EXPORT = migrationExportJob;
export const MIGRATION_IMPORT = migrationImportJob;
export const MIGRATION_MEMBERS_IMPORT = migrationMembersImportJob;
export const MIGRATION_IMPORT_FINISHED = migrationImportFinishedJob;
export const MIGRATION_FILES_EXPIRY = "migration.files-expiry";
export const migrationFilesExpiryCron = "35 4 * * *";

export type ExpireMigrationFiles = () => Promise<MigrationFilesExpiry>;

export type RunMigrationJob = (
  name: MigrationJobName,
  payload: MigrationJobPayload,
) => Promise<RunOutcome>;

export function createMigrationHandler(
  logger: Logger,
  name: MigrationJobName,
  run: RunMigrationJob,
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = migrationJobPayloadSchema.parse(job.data);
      const outcome = await run(name, payload);
      logger.info(
        { jobId: job.id, job: job.name, migrationJobId: payload.jobId, outcome },
        "migration job finished",
      );
    }
  };
}

export function createMigrationFilesExpiryHandler(logger: Logger, run: ExpireMigrationFiles) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "expired migration files deleted");
    }
  };
}

export const migrationJobDefinitions: readonly JobDefinition[] = (
  [MIGRATION_EXPORT, MIGRATION_IMPORT, MIGRATION_MEMBERS_IMPORT, MIGRATION_IMPORT_FINISHED] as const
).map((name) => ({
  name,
  queueOptions: { ...migrationQueueOptions },
  payloadSchema: migrationJobPayloadSchema,
  handler: ({ logger, deps }) => createMigrationHandler(logger, name, deps.runMigration),
}));

export const migrationFilesExpiryJobDefinition: JobDefinition = {
  name: MIGRATION_FILES_EXPIRY,
  queueOptions: { policy: "stately" },
  cron: migrationFilesExpiryCron,
  handler: ({ logger, deps }) =>
    createMigrationFilesExpiryHandler(logger, deps.expireMigrationFiles),
};
