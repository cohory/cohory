import { newId } from "@cohory/db";
import {
  memberships,
  migrationIdMap,
  users,
  type MigrationEmailChoice,
  type MigrationJob,
  type MigrationJobKind,
} from "@cohory/db/schema";
import {
  migrationExportReadyEmail,
  migrationImportFailedEmail,
  migrationImportFinishedEmail,
} from "@cohory/email";
import { isStorageKey, parseStorageKey } from "@cohory/storage";
import { and, eq, sql } from "drizzle-orm";

import { applyMembersImport } from "./csv/members";
import { MigrationError } from "./errors";
import { collectCommunity } from "./export/collect";
import { readArchive, writeArchive, type ParsedArchive } from "./format/archive";
import { schemaVersion } from "./format/manifest";
import { IdMap } from "./import/id-map";
import { restoreArchive } from "./import/restore";
import { maxSkippedListed, type ImportSummary } from "./import/summary";
import {
  expiresAfter,
  exportLifetimeDays,
  hasPersonalRows,
  withoutPersonalRows,
} from "./lifecycle";
import { applyAuthorChoices, authorChoicesSchema } from "./importers/author-choices";
import {
  migrationImportFinishedJob,
  migrationQueueOptions,
  type MigrationJobPayload,
} from "./jobs";
import { nextUtcDay, noteOf, sendImportEmails, withEmailCounts } from "./member-emails";
import {
  archiveKey,
  assertFreshCommunity,
  audit,
  emailBrandOf,
  loadCommunity,
  readStoredFile,
  roleOf,
  type Runtime,
} from "./runtime";
import { inMigrationScope } from "./scope";
import type {
  ExportSummary,
  ImportPreview,
  MembersCsvPreview,
  MembersImportMode,
  MembersImportSummary,
  PlatformImportSource,
} from "./views";

export type RunOutcome = "succeeded" | "skipped";

function withImporterReport(
  summary: ImportSummary,
  source: PlatformImportSource | null,
): ImportSummary {
  if (!source) return summary;
  const fromFiles = source.skipped.map((row) => ({
    entity: row.file,
    sourceId: row.row,
    reason: row.reason,
    ...(row.values ? { values: row.values } : {}),
  }));
  return {
    ...summary,
    skipped: [...fromFiles, ...summary.skipped].slice(0, maxSkippedListed),
    skippedTotal: source.skippedTotal + summary.skippedTotal,
    warnings: source.warnings,
  };
}

async function claim(
  runtime: Runtime,
  payload: MigrationJobPayload,
  kind: MigrationJobKind,
): Promise<MigrationJob | null> {
  const job = await runtime.jobs.get(payload.communityId, payload.jobId);
  if (!job || job.kind !== kind) {
    return null;
  }
  const claimed = await runtime.jobs.transition(
    payload.communityId,
    payload.jobId,
    ["queued", "running", "failed"],
    {
      status: "running",
      startedAt: runtime.now(),
      errorCode: null,
    },
  );
  if (claimed) {
    await inMigrationScope(runtime.db, payload.communityId, ({ tx }) =>
      tx.execute(
        sql`update migration_jobs set attempts = attempts + 1 where id = ${payload.jobId} and community_id = ${payload.communityId}`,
      ),
    );
  }
  return claimed;
}

async function requireOwner(runtime: Runtime, job: MigrationJob): Promise<string> {
  const ownerId = job.requestedBy;
  if (!ownerId || (await roleOf(runtime, job.communityId, ownerId)) !== "owner") {
    throw new MigrationError("validation_failed", "Only the community owner can run this job.");
  }
  return ownerId;
}

async function settle<T>(runtime: Runtime, job: MigrationJob, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    await runtime.jobs.update(job.communityId, job.id, {
      status: "failed",
      errorCode: error instanceof MigrationError ? error.code : "internal_error",
      finishedAt: runtime.now(),
      ...withoutPersonalRows(job),
    });
    if (job.attempts + 1 > migrationQueueOptions.retryLimit) {
      await runtime.queue.enqueue(migrationImportFinishedJob, {
        jobId: job.id,
        communityId: job.communityId,
      });
    }
    throw error;
  }
}

export async function runExportJob(
  runtime: Runtime,
  payload: MigrationJobPayload,
): Promise<RunOutcome> {
  const job = await claim(runtime, payload, "export");
  if (!job) return "skipped";
  const outcome = await settle(runtime, job, async () => {
    const ownerId = await requireOwner(runtime, job);
    const community = await loadCommunity(runtime, job.communityId);
    await runtime.jobs.update(job.communityId, job.id, {
      progress: { phase: "reading", done: 0, total: 1 },
    });
    const collected = await collectCommunity(runtime.db, community.id);
    const uploads = new Map<string, Uint8Array>();
    const missing: string[] = [];
    for (const [index, key] of collected.uploadKeys.entries()) {
      const bytes = isStorageKey(key) ? await readStoredFile(runtime.contentStorage, key) : null;
      if (bytes) uploads.set(key, bytes);
      else missing.push(key);
      if (index % 50 === 0) {
        await runtime.jobs.update(job.communityId, job.id, {
          progress: { phase: "uploads", done: index, total: collected.uploadKeys.length },
        });
      }
    }
    const exportedAt = runtime.now();
    const bytes = writeArchive({
      meta: {
        edition: runtime.fairUse.edition,
        exportedAt,
        community: { id: community.id, slug: community.slug, name: community.name },
        missingUploads: missing,
      },
      records: collected.records,
      uploads,
    });
    if (bytes.byteLength > runtime.config.archiveMaxBytes) {
      throw new MigrationError(
        "archive_too_large",
        "The archive is larger than this instance allows.",
      );
    }
    const key = archiveKey(community.id, "exports", job.id);
    await runtime.archiveStorage.put({ key, body: bytes, contentType: "application/zip" });
    const counts: Record<string, number> = {};
    for (const [entity, rows] of Object.entries(collected.records)) counts[entity] = rows.length;
    const summary: ExportSummary = {
      counts,
      uploads: {
        count: uploads.size,
        bytes: [...uploads.values()].reduce((sum, b) => sum + b.byteLength, 0),
      },
      missingUploads: missing,
      schemaVersion,
    };
    await runtime.jobs.update(job.communityId, job.id, {
      status: "succeeded",
      fileKey: key,
      fileName: `${community.slug}-archive-${exportedAt.toISOString().slice(0, 10)}.zip`,
      fileBytes: bytes.byteLength,
      summary,
      progress: { phase: "done", done: 1, total: 1 },
      finishedAt: runtime.now(),
      expiresAt: expiresAfter(runtime, exportLifetimeDays),
    });
    await audit(runtime, community.id, {
      actorId: ownerId,
      action: "migration.export",
      metadata: { jobId: job.id, bytes: bytes.byteLength },
    });
    return "succeeded" as const;
  });
  await runtime.queue.enqueue(migrationImportFinishedJob, {
    jobId: job.id,
    communityId: job.communityId,
  });
  return outcome;
}

export async function loadArchive(runtime: Runtime, key: string): Promise<ParsedArchive> {
  const bytes = await readStoredFile(runtime.archiveStorage, key);
  if (!bytes) {
    throw new MigrationError("not_found", "The uploaded archive is gone. Upload it again.");
  }
  return readArchive(bytes, {
    maxBytes: runtime.config.archiveMaxBytes,
    maxUploadBytes: runtime.config.archiveMaxBytes,
  });
}

export async function runImportJob(
  runtime: Runtime,
  payload: MigrationJobPayload,
): Promise<RunOutcome> {
  const job = await claim(runtime, payload, "import");
  if (!job) return "skipped";
  const outcome = await settle(runtime, job, async () => {
    const ownerId = await requireOwner(runtime, job);
    const community = await loadCommunity(runtime, job.communityId);
    if (!job.fileKey) {
      throw new MigrationError("not_found", "The uploaded archive is gone. Upload it again.");
    }
    const loaded = await loadArchive(runtime, job.fileKey);
    const source = (job.preview as ImportPreview | null)?.source ?? null;
    const choices = authorChoicesSchema.safeParse(job.options?.["authors"] ?? {});
    const archive: ParsedArchive = source
      ? {
          ...loaded,
          records: applyAuthorChoices(
            { ...loaded.records, community: [] },
            choices.success ? choices.data : {},
          ),
        }
      : loaded;
    const map = await IdMap.load(runtime.db, community.id, job.id);
    if (map.size === 0) {
      await assertFreshCommunity(runtime, community.id, ownerId);
    }
    const choice = emailChoiceOf(job);
    const summary = await restoreArchive(
      {
        db: runtime.db,
        storage: runtime.contentStorage,
        now: runtime.now,
        edition: runtime.fairUse.edition,
        appUrl: runtime.config.appUrl,
        onProgress: (progress) => runtime.jobs.update(community.id, job.id, { progress }),
      },
      {
        jobId: job.id,
        communityId: community.id,
        ownerUserId: ownerId,
        archive,
        membersEmailed: choice !== "never",
      },
    );
    const restored: ImportSummary = { ...withImporterReport(summary, source), emailsSent: 0 };
    const finalSummary: ImportSummary =
      choice === "now"
        ? withEmailCounts(
            restored,
            await sendImportEmails(runtime, { ...job, summary: restored }, ownerId),
          )
        : { ...restored, emailsNotSent: 0 };
    await runtime.archiveStorage.delete(parseStorageKey(job.fileKey));
    await runtime.jobs.update(community.id, job.id, {
      status: "succeeded",
      summary: finalSummary,
      fileKey: null,
      finishedAt: runtime.now(),
      expiresAt: null,
      emailChoice: choice,
      ...(choice === "now" ? { emailsSentAt: runtime.now() } : {}),
    });
    await audit(runtime, community.id, {
      actorId: ownerId,
      action: "migration.import",
      metadata: {
        jobId: job.id,
        sourceCommunity: archive.manifest.community.slug,
        schemaVersion: archive.manifest.schemaVersion,
        ...(source
          ? { importer: source.importer.id, importerVersion: source.importer.version }
          : {}),
        skipped: summary.skippedTotal,
      },
    });
    return "succeeded" as const;
  });
  await runtime.queue.enqueue(migrationImportFinishedJob, {
    jobId: job.id,
    communityId: job.communityId,
  });
  return outcome;
}

export async function runMembersImportJob(
  runtime: Runtime,
  payload: MigrationJobPayload,
): Promise<RunOutcome> {
  const job = await claim(runtime, payload, "members_csv");
  if (!job) return "skipped";
  const outcome = await settle(runtime, job, async () => {
    const ownerId = await requireOwner(runtime, job);
    const community = await loadCommunity(runtime, job.communityId);
    const preview = job.preview as MembersCsvPreview | null;
    const mode: MembersImportMode = job.options?.mode === "add" ? "add" : "invite";
    if (!preview || (preview.totals.rows > 0 && !hasPersonalRows(job))) {
      throw new MigrationError("job_not_ready", "Upload the file again.");
    }
    if (mode === "add" && runtime.fairUse.edition !== "community") {
      throw new MigrationError(
        "validation_failed",
        "Adding members directly is for self hosted communities.",
      );
    }
    const summary = await applyMembersImport(
      runtime,
      {
        jobId: job.id,
        community,
        actorId: ownerId,
        preview,
        mode,
        notify: job.options?.notify === true,
        resend: job.options?.["resend"] === true,
        note: noteOf(job.options),
      },
      (done, total) =>
        runtime.jobs.update(community.id, job.id, { progress: { phase: mode, done, total } }),
    );
    await runtime.jobs.update(community.id, job.id, {
      status: "succeeded",
      summary,
      preview: { ...preview, rows: [] },
      finishedAt: runtime.now(),
      expiresAt: null,
    });
    await audit(runtime, community.id, {
      actorId: ownerId,
      action: "migration.members_csv",
      metadata: { jobId: job.id, ...summary },
    });
    return "succeeded" as const;
  });
  await runtime.queue.enqueue(migrationImportFinishedJob, {
    jobId: job.id,
    communityId: job.communityId,
  });
  return outcome;
}

function sourceName(job: MigrationJob): string {
  if (job.kind === "members_csv") return "Members CSV";
  return (job.preview as ImportPreview | null)?.source?.name ?? "Cohory archive";
}

async function currentOwner(
  runtime: Runtime,
  communityId: string,
  requestedBy: string,
): Promise<{ email: string; name: string } | null> {
  const stillOwner = (await roleOf(runtime, communityId, requestedBy)) === "owner";
  const [owner] = await inMigrationScope(runtime.db, communityId, ({ tx, where }) =>
    tx
      .select({ email: users.email, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        where(
          memberships,
          stillOwner
            ? eq(memberships.userId, requestedBy)
            : and(eq(memberships.role, "owner"), eq(memberships.status, "active")),
        ),
      )
      .limit(1),
  );
  return owner ?? null;
}

async function claimOwnerEmail(
  runtime: Runtime,
  job: MigrationJob,
  sourceId: string,
): Promise<boolean> {
  const claimed = await inMigrationScope(runtime.db, job.communityId, ({ tx }) =>
    tx
      .insert(migrationIdMap)
      .values({
        communityId: job.communityId,
        jobId: job.id,
        entity: "owner_email",
        sourceId,
        targetId: newId(),
      })
      .onConflictDoNothing()
      .returning({ jobId: migrationIdMap.jobId }),
  );
  return claimed.length > 0;
}

export function emailChoiceOf(job: MigrationJob): MigrationEmailChoice {
  return job.emailChoice ?? (job.options?.["notifyNewUsers"] === true ? "now" : "never");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function importOutcome(job: MigrationJob): string {
  if (job.kind === "members_csv") {
    const summary = job.summary as MembersImportSummary | null;
    if (!summary) return "";
    const done =
      summary.mode === "invite"
        ? plural(summary.invited, "invitation sent", "invitations sent")
        : plural(summary.added, "member added", "members added");
    return `${done}. ${plural(summary.skipped, "row skipped", "rows skipped")}.`;
  }
  const summary = job.summary as ImportSummary | null;
  if (!summary) return "";
  const moved = [
    ["memberships", "member", "members"],
    ["posts", "post", "posts"],
    ["comments", "comment", "comments"],
    ["courses", "course", "courses"],
    ["events", "event", "events"],
  ] as const;
  const counts = moved
    .filter(([entity]) => (summary.imported[entity] ?? 0) > 0)
    .map(([entity, one, many]) => plural(summary.imported[entity] ?? 0, one, many));
  const emails =
    emailChoiceOf(job) === "later"
      ? "No emails went out yet. When you are ready, send the emails from Import history."
      : emailChoiceOf(job) === "now"
        ? `${plural(summary.emailsSent, "email", "emails")} sent.`
        : "";
  const overLimit = summary.emailsOverLimit ?? 0;
  return [
    counts.length > 0 ? `${counts.join(", ")} moved.` : "",
    `${plural(summary.skippedTotal, "row", "rows")} skipped.`,
    emails,
    overLimit > 0
      ? `${plural(overLimit, "person was", "people were")} not emailed because your plan allows fewer members.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function sendLaterEmails(
  runtime: Runtime,
  job: MigrationJob,
  actorId: string,
): Promise<boolean> {
  if (job.kind !== "import") return false;
  const choice = emailChoiceOf(job);
  if (choice !== "now" && (choice !== "later" || !job.emailsSentAt)) return false;
  const summary = job.summary as ImportSummary | null;
  const before = summary?.emailsSent ?? 0;
  const emails = await sendImportEmails(runtime, job, actorId);
  if (summary) {
    await runtime.jobs.update(job.communityId, job.id, {
      summary: withEmailCounts(summary, emails),
    });
  }
  if (emails.deferred) {
    await runtime.queue.enqueue(
      migrationImportFinishedJob,
      { jobId: job.id, communityId: job.communityId },
      { startAfter: nextUtcDay(runtime.now()) },
    );
  }
  return emails.sent > before;
}

export async function runImportFinishedJob(
  runtime: Runtime,
  payload: MigrationJobPayload,
): Promise<RunOutcome> {
  const job = await runtime.jobs.get(payload.communityId, payload.jobId);
  if (!job || !job.requestedBy || (job.status !== "succeeded" && job.status !== "failed")) {
    return "skipped";
  }
  if (!runtime.mailer) return "skipped";
  const membersEmailed =
    job.status === "succeeded" && (await sendLaterEmails(runtime, job, job.requestedBy));
  const owner = await currentOwner(runtime, job.communityId, job.requestedBy);
  if (!owner) return membersEmailed ? "succeeded" : "skipped";
  const claimKey = job.status === "failed" ? `failed:${job.id}` : job.id;
  if (!(await claimOwnerEmail(runtime, job, claimKey))) {
    return membersEmailed ? "succeeded" : "skipped";
  }
  const community = await loadCommunity(runtime, job.communityId);
  const appUrl = runtime.config.appUrl;
  const slug = encodeURIComponent(community.slug);
  const base = {
    name: owner.name,
    communityName: community.name,
    communityBrand: emailBrandOf(runtime, community),
    migrationUrl: `${appUrl}/c/${slug}/manage/migration`,
  };
  const api = `${appUrl}/api/v1/communities/${slug}/manage/migration`;
  const content =
    job.status === "failed"
      ? migrationImportFailedEmail({
          ...base,
          source: job.kind === "export" ? null : sourceName(job),
        })
      : job.kind === "export"
        ? migrationExportReadyEmail({
            ...base,
            downloadUrl: `${api}/exports/${job.id}/download`,
            lifetimeDays: exportLifetimeDays,
          })
        : migrationImportFinishedEmail({
            ...base,
            source: sourceName(job),
            reportUrl: `${api}/jobs/${job.id}/report`,
            outcome: importOutcome(job),
          });
  await runtime.mailer.send({ to: owner.email, communityId: community.id, ...content });
  return "succeeded";
}
