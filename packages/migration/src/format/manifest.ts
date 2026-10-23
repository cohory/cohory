import { z } from "zod";

import { archiveEntities, type ArchiveEntity } from "./records";

export const archiveFormat = "cohory-archive";
export const schemaVersion = "1.6.0";
export const cohoryVersion = "0.12.0";

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

export const manifestSchema = z.object({
  format: z.literal(archiveFormat),
  schemaVersion: semver,
  cohoryVersion: z.string().min(1).max(40),
  edition: z.enum(["community", "cloud"]),
  exportedAt: z.iso.datetime({ offset: true }),
  community: z.object({
    id: z.uuid(),
    slug: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
  }),
  counts: z.record(z.string(), z.int().min(0)),
  uploads: z.object({ count: z.int().min(0), bytes: z.int().min(0) }),
  missingUploads: z.array(z.string().max(512)),
  files: z.array(
    z.object({
      path: z.string().min(1).max(600),
      bytes: z.int().min(0),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export type Manifest = z.output<typeof manifestSchema>;

export type EntityCounts = Readonly<Record<ArchiveEntity, number>>;

export function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return [major, minor, patch];
}

export function isSupportedSchemaVersion(version: string): boolean {
  const [major, minor] = parts(version);
  const [supportedMajor, supportedMinor] = parts(schemaVersion);
  return major === supportedMajor && minor <= supportedMinor;
}

export function emptyCounts(): Record<ArchiveEntity, number> {
  return Object.fromEntries(archiveEntities.map((entity) => [entity, 0])) as Record<
    ArchiveEntity,
    number
  >;
}
