import { z } from "zod";

export const migrationExportJob = "migration.export";
export const migrationImportJob = "migration.import";
export const migrationMembersImportJob = "migration.members-import";
export const migrationImportFinishedJob = "migration.import-finished";

export const migrationJobNames = [
  migrationExportJob,
  migrationImportJob,
  migrationMembersImportJob,
  migrationImportFinishedJob,
] as const;

export type MigrationJobName = (typeof migrationJobNames)[number];

export const migrationQueueOptions = { retryLimit: 2, retryDelay: 30, retryBackoff: true } as const;

export const migrationJobPayloadSchema = z.object({
  jobId: z.uuid(),
  communityId: z.uuid(),
});

export type MigrationJobPayload = z.output<typeof migrationJobPayloadSchema>;

export interface MigrationEnqueueOptions {
  readonly startAfter?: Date;
}

export interface MigrationQueue {
  enqueue(
    name: MigrationJobName,
    payload: MigrationJobPayload,
    options?: MigrationEnqueueOptions,
  ): Promise<void>;
}
