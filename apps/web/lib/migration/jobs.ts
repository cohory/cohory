import type {
  ArchiveResult,
  CsvPreview,
  CsvResult,
  ExportJobItem,
  ImportArchiveStage,
  MembersCsvStage,
} from "@cohory/ui";
import { z } from "zod";

const progressSchema = z.object({ phase: z.string(), done: z.number(), total: z.number() });

export const migrationJobJsonSchema = z.object({
  id: z.string(),
  kind: z.enum(["export", "import", "members_csv"]),
  status: z.enum(["ready", "queued", "running", "succeeded", "failed"]),
  fileName: z.string().nullable(),
  fileBytes: z.number().nullable(),
  progress: progressSchema.nullable(),
  preview: z.record(z.string(), z.unknown()).nullable(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  downloadable: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  emailChoice: z.enum(["now", "later", "never"]).nullable().optional(),
  emailsSentAt: z.string().nullable().optional(),
});

export type MigrationJobJson = z.infer<typeof migrationJobJsonSchema>;

export const migrationJobListSchema = z.object({ data: z.array(migrationJobJsonSchema) });

const counts = z.record(z.string(), z.number());

const archivePreviewSchema = z.object({
  community: z.object({ name: z.string() }),
  exportedAt: z.string(),
  schemaVersion: z.string(),
  edition: z.enum(["community", "cloud"]),
  counts,
  people: z.object({
    total: z.number(),
    existing: z.number(),
    new: z.number(),
    keptApart: z.number().optional(),
    inviteOnly: z.boolean().optional(),
  }),
  uploads: z.object({ count: z.number() }),
  warnings: z.array(z.string()),
});

const archiveSummarySchema = z.object({
  imported: counts,
  users: z.object({ created: z.number(), linked: z.number(), invited: z.number().default(0) }),
  ownerImportedAs: z.enum(["owner", "admin", "none"]),
  skipped: z.array(
    z.object({
      entity: z.string(),
      sourceId: z.string().optional(),
      reason: z.string(),
      values: z.record(z.string(), z.string()).optional(),
    }),
  ),
  skippedTotal: z.number(),
  warnings: z.array(z.string()).default([]),
  subscriptionLinks: z.array(z.unknown()),
  emailsSent: z.number(),
  emailsNotSent: z.number().default(0),
  emailsOverLimit: z.number().default(0),
});

const csvPreviewSchema = z.object({
  rows: z.array(
    z.object({
      line: z.number(),
      email: z.string(),
      name: z.string().nullable(),
      role: z.string().nullable(),
      status: z.enum([
        "ready",
        "new_account",
        "existing_account",
        "already_member",
        "invited",
        "left_out",
        "error",
      ]),
      message: z.string().nullable(),
      values: z.record(z.string(), z.string()).optional(),
    }),
  ),
  totals: z.object({
    ready: z.number(),
    errors: z.number(),
    alreadyMembers: z.number(),
    invited: z.number().default(0),
    leftOut: z.number().default(0),
    newAccounts: z.number().nullable(),
  }),
  notes: z.array(z.string()).default([]),
  memberLimit: z.number().nullable(),
  activeMembers: z.number(),
  addAllowed: z.boolean(),
});

const csvSummarySchema = z.object({
  mode: z.enum(["invite", "add"]),
  added: z.number(),
  invited: z.number(),
  skipped: z.number(),
  emailsSent: z.number(),
  notSent: z.number().optional(),
  limitReached: z.boolean(),
  skippedRows: z.array(z.object({ line: z.number(), reason: z.string() })).optional(),
});

const errorMessages: Readonly<Record<string, string>> = {
  forbidden: "Only the owner can do this.",
  community_not_empty: "Import into a new, empty community.",
  archive_too_large: "The archive is larger than this server allows.",
  invalid_csv: "A file could not be read. Check the file and try again.",
  job_in_progress: "Another job is still running. Wait for it to finish.",
  job_not_ready: "This job already started. Reload the page to see where it is.",
  internal_error: "Something went wrong on our side. Try again.",
  checksum_mismatch: "The archive is damaged or was changed after export. Export it again.",
  invalid_archive: "The archive could not be read.",
  unsupported_schema_version: "This archive comes from a newer version of Cohory. Update first.",
  not_found: "The uploaded file is gone. Upload it again.",
  limit_reached: "The member limit was reached.",
  validation_failed: "Something in the file or settings is not valid.",
};

export function jobErrorMessage(code: string | null): string {
  return (code ? errorMessages[code] : undefined) ?? "Something went wrong. Try again.";
}

export const importedReason =
  "An import already ran in this community. See Import history. To import again, create a new community.";

function migrationBase(slug: string): string {
  return `/api/v1/communities/${encodeURIComponent(slug)}/manage/migration`;
}

export function downloadHref(slug: string, jobId: string): string {
  return `${migrationBase(slug)}/exports/${jobId}/download`;
}

const countNames: readonly (readonly [string, string, string])[] = [
  ["memberships", "member", "members"],
  ["posts", "post", "posts"],
  ["comments", "comment", "comments"],
  ["courses", "course", "courses"],
  ["lessons", "lesson", "lessons"],
  ["events", "event", "events"],
];

function countsText(counts: Readonly<Record<string, number>> | undefined): string | null {
  if (!counts) return null;
  const parts = countNames.flatMap(([key, one, many]) => {
    const count = counts[key] ?? 0;
    return count > 0 ? [`${count.toLocaleString("en")} ${count === 1 ? one : many}`] : [];
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

const exportSummarySchema = z.object({ counts });

const historySummarySchema = z.object({
  imported: counts.optional(),
  skippedTotal: z.number().optional(),
  mode: z.enum(["invite", "add"]).optional(),
  added: z.number().optional(),
  invited: z.number().optional(),
  skipped: z.union([z.number(), z.array(z.unknown())]).optional(),
  emailsSent: z.number().default(0),
});

const historySourceSchema = z.object({ source: z.object({ name: z.string() }) });

export interface ImportHistoryItem {
  readonly id: string;
  readonly source: string;
  readonly status: "succeeded" | "failed";
  readonly at: string;
  readonly counts: string | null;
  readonly skipped: number;
  readonly emailsSent: number;
  readonly emailsWaiting: boolean;
  readonly errorMessage: string | null;
  readonly reportHref: string;
}

function historySource(job: MigrationJobJson): string {
  if (job.kind === "members_csv") return "Members CSV";
  const parsed = historySourceSchema.safeParse(job.preview);
  return parsed.success ? parsed.data.source.name : "Cohory archive";
}

function historyCounts(summary: z.infer<typeof historySummarySchema> | undefined): string | null {
  if (!summary) return null;
  if (summary.mode === "invite") return `${summary.invited ?? 0} invited`;
  if (summary.mode === "add") return `${summary.added ?? 0} added`;
  return countsText(summary.imported);
}

function emailsWaiting(job: MigrationJobJson): boolean {
  return job.status === "succeeded" && job.emailChoice === "later" && !job.emailsSentAt;
}

export function sendEmailsHref(slug: string, jobId: string): string {
  return `${migrationBase(slug)}/imports/${jobId}/emails`;
}

export function importHistory(
  slug: string,
  jobs: readonly MigrationJobJson[],
): ImportHistoryItem[] {
  return jobs.flatMap((job) => {
    if (job.kind === "export") return [];
    if (job.status !== "succeeded" && job.status !== "failed") return [];
    const summary = historySummarySchema.safeParse(job.summary ?? undefined);
    const data = summary.success ? summary.data : undefined;
    return [
      {
        id: job.id,
        source: historySource(job),
        status: job.status,
        at: job.finishedAt ?? job.createdAt,
        counts: historyCounts(data),
        skipped: data?.skippedTotal ?? (typeof data?.skipped === "number" ? data.skipped : 0),
        emailsSent: data?.emailsSent ?? 0,
        emailsWaiting: emailsWaiting(job),
        errorMessage: job.status === "failed" ? jobErrorMessage(job.errorCode) : null,
        reportHref: `${migrationBase(slug)}/jobs/${job.id}/report`,
      },
    ];
  });
}

function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024)).toLocaleString("en")} MB`;
}

export function uploadSizeError(
  files: readonly { readonly name: string; readonly size: number }[],
  maxBytes: number,
): string | null {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxBytes) return null;
  const [only] = files;
  const subject = files.length === 1 && only ? `${only.name} is` : "These files are";
  const together = files.length === 1 ? "" : " together";
  return `${subject} ${megabytes(total)}${together}. The limit is ${megabytes(maxBytes)}.`;
}

function runningProgress(job: MigrationJobJson) {
  return job.progress ? { ...job.progress, startedAt: job.startedAt } : null;
}

export function exportItems(slug: string, jobs: readonly MigrationJobJson[]): ExportJobItem[] {
  return jobs
    .filter((job) => job.kind === "export")
    .map((job) => ({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      fileBytes: job.fileBytes,
      progress: runningProgress(job),
      downloadHref: job.downloadable ? downloadHref(slug, job.id) : null,
      errorMessage: job.status === "failed" ? jobErrorMessage(job.errorCode) : null,
      contents: countsText(exportSummarySchema.safeParse(job.summary).data?.counts),
      expiresAt: job.expiresAt,
      deletedAt: job.deletedAt,
    }));
}

export function canRetry(job: MigrationJobJson, now: number = Date.now()): boolean {
  if (job.deletedAt) return false;
  if (job.expiresAt && Date.parse(job.expiresAt) <= now) return false;
  if (job.kind !== "members_csv") return true;
  const rows = job.preview?.["rows"];
  return Array.isArray(rows) && rows.length > 0;
}

export function archiveStage(
  job: MigrationJobJson | undefined,
  now: number = Date.now(),
): ImportArchiveStage {
  if (!job) return { kind: "idle" };
  if (job.status === "failed") {
    return {
      kind: "failed",
      message: jobErrorMessage(job.errorCode),
      canRetry: canRetry(job, now),
    };
  }
  if (job.status === "queued" || job.status === "running") {
    return { kind: "running", progress: runningProgress(job) };
  }
  if (job.status === "ready") {
    const preview = archivePreviewSchema.safeParse(job.preview);
    if (!preview.success) return { kind: "idle" };
    return {
      kind: "preview",
      preview: {
        communityName: preview.data.community.name,
        exportedAt: preview.data.exportedAt,
        schemaVersion: preview.data.schemaVersion,
        edition: preview.data.edition,
        counts: preview.data.counts,
        people: preview.data.people,
        uploads: preview.data.uploads.count,
        warnings: preview.data.warnings,
      },
    };
  }
  const summary = archiveSummarySchema.safeParse(job.summary);
  if (!summary.success) return { kind: "idle" };
  const result: ArchiveResult = {
    imported: summary.data.imported,
    createdAccounts: summary.data.users.created,
    linkedAccounts: summary.data.users.linked,
    invitedAccounts: summary.data.users.invited,
    ownerImportedAs: summary.data.ownerImportedAs,
    skipped: summary.data.skipped,
    skippedTotal: summary.data.skippedTotal,
    warnings: summary.data.warnings,
    subscriptionsToLink: summary.data.subscriptionLinks.length,
    emailsSent: summary.data.emailsSent,
    emailsNotSent: summary.data.emailsNotSent,
    emailsOverLimit: summary.data.emailsOverLimit,
    emailChoice: job.emailChoice ?? null,
  };
  return { kind: "done", result };
}

export function csvStage(
  job: MigrationJobJson | undefined,
  now: number = Date.now(),
): MembersCsvStage {
  if (!job) return { kind: "idle" };
  if (job.status === "failed") {
    return {
      kind: "failed",
      message: jobErrorMessage(job.errorCode),
      canRetry: canRetry(job, now),
    };
  }
  if (job.status === "queued" || job.status === "running") {
    return { kind: "running", progress: runningProgress(job) };
  }
  if (job.status === "ready") {
    const parsed = csvPreviewSchema.safeParse(job.preview);
    if (!parsed.success) return { kind: "idle" };
    const preview: CsvPreview = {
      rows: parsed.data.rows,
      ready: parsed.data.totals.ready,
      errors: parsed.data.totals.errors,
      alreadyMembers: parsed.data.totals.alreadyMembers,
      invited: parsed.data.totals.invited,
      leftOut: parsed.data.totals.leftOut,
      notes: parsed.data.notes,
      newAccounts: parsed.data.totals.newAccounts,
      memberLimit: parsed.data.memberLimit,
      activeMembers: parsed.data.activeMembers,
      addAllowed: parsed.data.addAllowed,
    };
    return { kind: "preview", preview };
  }
  const summary = csvSummarySchema.safeParse(job.summary);
  if (!summary.success) return { kind: "idle" };
  const { notSent, skippedRows, ...rest } = summary.data;
  const result: CsvResult = {
    ...rest,
    ...(notSent === undefined ? {} : { notSent }),
    ...(skippedRows === undefined ? {} : { skippedRows }),
  };
  return { kind: "done", result };
}

export function isActive(job: MigrationJobJson): boolean {
  return job.status === "queued" || job.status === "running";
}
