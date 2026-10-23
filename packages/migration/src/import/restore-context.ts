import { newId, type Database } from "@cohory/db";
import type { MigrationProgressJson } from "@cohory/db/schema";
import { isStorageKey, parseStorageKey, type StorageDriver } from "@cohory/storage";

import type { ParsedArchive } from "../format/archive";
import type { ArchiveRecords } from "../format/records";
import { inMigrationScope, type MigrationTx } from "../scope";
import type { Edition } from "./accounts";
import type { AgentRestorePhase } from "./agent-material";
import { rewriteStorageKey, type ContentRewrite, type KeyRewrite } from "./content";
import { IdMap, type MappedId } from "./id-map";
import { planImportSlugs, type ImportSlugs } from "./slugs";
import { SkipLog } from "./summary";

export const restoreBatchSize = 500;

export interface RestoreDeps {
  readonly db: Database;
  readonly storage: Pick<StorageDriver, "put" | "publicUrl">;
  readonly now: () => Date;
  readonly edition: Edition;
  readonly appUrl?: string;
  readonly onProgress?: (progress: MigrationProgressJson) => Promise<void>;
}

export interface RestoreInput {
  readonly jobId: string;
  readonly communityId: string;
  readonly ownerUserId: string;
  readonly archive: ParsedArchive;
  readonly membersEmailed?: boolean;
}

/** What every restore phase shares: the archive, the id map, the skip log, and the helpers. */
export interface RestoreContext {
  readonly deps: RestoreDeps;
  readonly input: RestoreInput;
  readonly records: ArchiveRecords;
  readonly archive: ParsedArchive;
  readonly target: string;
  readonly map: IdMap;
  readonly skips: SkipLog;
  readonly slugs: ImportSlugs;
  readonly total: number;
  readonly progress: (phase: string, processed: number) => Promise<void>;
  readonly scope: <T>(fn: (tx: MigrationTx) => Promise<T>) => Promise<T>;
  readonly phase: AgentRestorePhase;
  readonly rewriteKey: (key: string | null | undefined) => string | null;
  readonly user: (id: string | null | undefined) => string | undefined;
  readonly contentRewrite: ContentRewrite;
  readonly imageUrl: (key: string) => string;
}

export const date = (value: string) => new Date(value);
export const dateOrNull = (value: string | null) => (value ? new Date(value) : null);

export function chunks<T>(rows: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    result.push(rows.slice(start, start + size));
  }
  return result;
}

export function isHttpsUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function totalRecords(records: ArchiveRecords): number {
  return Object.values(records).reduce((sum, rows) => sum + rows.length, 0);
}

export async function createRestoreContext(
  deps: RestoreDeps,
  input: RestoreInput,
): Promise<RestoreContext> {
  const { db } = deps;
  const { records, uploads, manifest } = input.archive;
  const target = input.communityId;
  const map = await IdMap.load(db, target, input.jobId);
  const total = totalRecords(records) + uploads.size;
  let done = 0;

  const progress = async (phase: string, processed: number) => {
    done += processed;
    await deps.onProgress?.({ phase, done: Math.min(done, total), total });
  };

  const scope = <T>(fn: (tx: MigrationTx) => Promise<T>) =>
    inMigrationScope(db, target, ({ tx }) => fn(tx));

  const phase: AgentRestorePhase = async (entity, rows, key, write) => {
    for (const batch of chunks(rows, restoreBatchSize)) {
      const pending = batch.filter((row) => !map.has(entity, key(row)));
      if (pending.length > 0) {
        const assigned: MappedId[] = pending.map((row) => map.assign(entity, key(row)));
        const items = pending.map((row, index) => ({
          row,
          id: assigned[index]?.targetId ?? newId(),
        }));
        try {
          await scope(async (tx) => {
            const skipped = await write(tx, items);
            const kept = assigned.filter((entry) => !skipped.has(entry.sourceId));
            map.forget(assigned.filter((entry) => skipped.has(entry.sourceId)));
            await map.persist(tx, kept);
          });
        } catch (error: unknown) {
          map.forget(assigned);
          throw error;
        }
      }
      await progress(entity, batch.length);
    }
  };

  const keyRewrite: KeyRewrite = {
    sourceCommunityId: manifest.community.id,
    targetCommunityId: target,
    courseId: (id) => map.get("courses", id),
  };
  const rewriteKey = (key: string | null | undefined): string | null => {
    if (!key) return null;
    const next = rewriteStorageKey(key, keyRewrite);
    return next && isStorageKey(next) ? next : null;
  };
  const user = (id: string | null | undefined) => map.get("users", id);

  return {
    deps,
    input,
    records,
    archive: input.archive,
    target,
    map,
    skips: new SkipLog(),
    slugs: planImportSlugs(records),
    total,
    progress,
    scope,
    phase,
    rewriteKey,
    user,
    contentRewrite: { key: rewriteKey, user },
    imageUrl: (key) => deps.storage.publicUrl(parseStorageKey(key)),
  };
}
