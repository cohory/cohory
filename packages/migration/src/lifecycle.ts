import { communities, type MigrationJob } from "@cohory/db/schema";
import { parseStorageKey } from "@cohory/storage";

import type { Runtime } from "./runtime";
import type { JobPatch } from "./store";

export const previewLifetimeDays = 7;
export const exportLifetimeDays = 30;
export const stuckJobHours = 6;

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

export function expiresAfter(runtime: Runtime, days: number): Date {
  return new Date(runtime.now().getTime() + days * dayMs);
}

export async function deleteStoredFile(runtime: Runtime, key: string | null): Promise<void> {
  if (key) await runtime.archiveStorage.delete(parseStorageKey(key));
}

export function hasPersonalRows(job: Pick<MigrationJob, "kind" | "preview">): boolean {
  const rows = job.kind === "members_csv" ? job.preview?.["rows"] : undefined;
  return Array.isArray(rows) && rows.length > 0;
}

export function withoutPersonalRows(job: Pick<MigrationJob, "kind" | "preview">): JobPatch {
  return hasPersonalRows(job) && job.preview ? { preview: { ...job.preview, rows: [] } } : {};
}

export interface MigrationFilesExpiry {
  readonly previews: number;
  readonly files: number;
  readonly stuck: number;
}

async function failStuckJobs(runtime: Runtime, communityId: string, now: Date): Promise<number> {
  const startedBefore = new Date(now.getTime() - stuckJobHours * hourMs);
  let stuck = 0;
  for (const job of await runtime.jobs.listStuck(communityId, startedBefore)) {
    const failed = await runtime.jobs.transition(communityId, job.id, ["running"], {
      status: "failed",
      errorCode: "internal_error",
      finishedAt: now,
      ...withoutPersonalRows(job),
    });
    if (failed) stuck += 1;
  }
  return stuck;
}

export async function expireMigrationFiles(
  runtime: Runtime,
  communityIds?: readonly string[],
): Promise<MigrationFilesExpiry> {
  const now = runtime.now();
  const ids =
    communityIds ??
    (await runtime.db.select({ id: communities.id }).from(communities)).map((row) => row.id);
  let previews = 0;
  let files = 0;
  let stuck = 0;
  for (const communityId of ids) {
    stuck += await failStuckJobs(runtime, communityId, now);
    for (const job of await runtime.jobs.listExpired(communityId, now)) {
      if (job.status === "ready") {
        const removed = await runtime.jobs.remove(communityId, job.id, ["ready"]);
        if (!removed) continue;
        await deleteStoredFile(runtime, removed.fileKey);
        previews += 1;
        continue;
      }
      await runtime.jobs.update(communityId, job.id, {
        fileKey: null,
        deletedAt: now,
        ...withoutPersonalRows(job),
      });
      await deleteStoredFile(runtime, job.fileKey);
      if (job.fileKey) files += 1;
    }
  }
  return { previews, files, stuck };
}
