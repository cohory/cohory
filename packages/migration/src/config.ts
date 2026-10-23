import { parseAppUrl } from "@cohory/config/platform";
import { z } from "zod";

export const defaultArchiveMaxBytes = 512 * 1024 * 1024;
export const membersCsvMaxBytes = 1024 * 1024;
export const membersCsvMaxRows = 5000;

const envSchema = z.object({
  MIGRATION_ARCHIVE_MAX_BYTES: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().default(defaultArchiveMaxBytes),
  ),
});

export interface MigrationConfig {
  readonly archiveMaxBytes: number;
  readonly appUrl: string;
  readonly importEmailsPerDay?: number;
}

export const importEmailsPerDay = 1000;

export function parseMigrationEnv(env: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const parsed = envSchema.parse(env);
  return {
    archiveMaxBytes: parsed.MIGRATION_ARCHIVE_MAX_BYTES,
    appUrl: parseAppUrl(env),
  };
}
