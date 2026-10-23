import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { newId, type Community } from "@cohory/db";
import { assertMemberCapacity } from "@cohory/fair-use";
import { migrationEmailChoice } from "@cohory/db/schema";
import { migrationNoteMaxLength, type EmailContent } from "@cohory/email";
import type { StoredObject } from "@cohory/storage";
import { z } from "zod";

import { fitsMemberCapacity } from "./capacity";
import { membersCsvMaxBytes, membersCsvMaxRows } from "./config";
import { buildMembersPreview } from "./csv/members";
import { parseMembersCsv } from "./csv/parse";
import { MigrationError, MigrationNotFoundError } from "./errors";
import { readArchive, type ParsedArchive } from "./format/archive";
import { findAccounts, matchAccount } from "./import/accounts";
import {
  migrationExportJob,
  migrationImportFinishedJob,
  migrationImportJob,
  migrationMembersImportJob,
  type MigrationJobName,
} from "./jobs";
import {
  resendableUserIds,
  resendImportEmail,
  sampleImportEmail,
  userEmail,
} from "./member-emails";
import {
  activeMemberCount,
  archiveKey,
  assertFreshCommunity,
  createRuntime,
  loadCommunity,
  memberLimits,
  roleOf,
  type MigrationDeps,
  type Runtime,
} from "./runtime";
import { importerCatalog, isImporterId } from "./importers/catalog";
import { assertAuthorChoices, authorChoicesSchema } from "./importers/author-choices";
import { buildPlatformImport } from "./importers/service";
import type { ImportFile } from "./importers/types";
import { deleteStoredFile, expiresAfter, hasPersonalRows, previewLifetimeDays } from "./lifecycle";
import { buildImportReport, type MigrationReport } from "./report";
import { inMigrationScope } from "./scope";
import {
  toJobView,
  type ImportPreview,
  type MembersImportMode,
  type MigrationJobView,
} from "./views";

type UserActor = Extract<Actor, { kind: "user" }>;
type MigrationAction = "export" | "import" | "import_members";

export interface ExportDownload {
  readonly filename: string;
  readonly size: number;
  readonly body: StoredObject["body"];
}

const noteSchema = z.string().trim().max(migrationNoteMaxLength).optional();

export const confirmImportInputSchema = z.object({
  emailChoice: z.enum(migrationEmailChoice.enumValues).optional(),
  notifyNewUsers: z.boolean().optional(),
  note: noteSchema,
  authors: authorChoicesSchema.default({}),
});
export const confirmMembersInputSchema = z.object({
  mode: z.enum(["invite", "add"]),
  notify: z.boolean().default(false),
  resend: z.boolean().default(false),
  note: noteSchema,
});
export const importEmailPreviewInputSchema = z.object({ note: noteSchema });

export type ConfirmImportInput = z.input<typeof confirmImportInputSchema>;
export type ConfirmMembersInput = z.input<typeof confirmMembersInputSchema>;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new MigrationError(
      "validation_failed",
      "Some fields are not valid.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}

async function authorize(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  action: MigrationAction,
): Promise<{ user: UserActor; community: Community }> {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  const community = await loadCommunity(runtime, communityId);
  const role = await roleOf(runtime, community.id, actor.userId);
  if (role === null) {
    throw new MigrationNotFoundError("community");
  }
  assertCan(actor, action, "migration", { role, communityPrivacy: community.privacy });
  return { user: actor, community };
}

async function previewArchive(
  runtime: Runtime,
  community: Community,
  ownerUserId: string,
  archive: ParsedArchive,
): Promise<ImportPreview> {
  const { manifest, records } = archive;
  const emails = records.users.filter((row) => !row.erased).map((row) => row.email.toLowerCase());
  const rule = { edition: runtime.fairUse.edition, ownerUserId };
  let existing = 0;
  let keptApart = 0;
  for (let start = 0; start < emails.length; start += 1000) {
    const slice = emails.slice(start, start + 1000);
    const accounts = await inMigrationScope(runtime.db, community.id, ({ tx }) =>
      findAccounts(tx, slice),
    );
    for (const email of slice) {
      const match = matchAccount(accounts.get(email), rule).kind;
      if (match === "link") existing += 1;
      if (match === "placeholder") keptApart += 1;
    }
  }
  const activeMembers = records.memberships.filter((row) => row.status === "active").length;
  const warnings: string[] = [];
  const limits = await memberLimits(runtime, community);
  if (!fitsMemberCapacity(limits, Math.max(0, activeMembers - 1))) {
    warnings.push(
      `The archive has ${activeMembers} active members. This community allows ${limits.members ?? 0}.`,
    );
  }
  if (manifest.missingUploads.length > 0) {
    warnings.push(`Files missing when the archive was made: ${manifest.missingUploads.length}.`);
  }
  const activeSubscriptions = records.subscriptions.filter(
    (row) => (row.accessState === "granted" || row.accessState === "grace") && !row.endedAt,
  ).length;
  if (activeSubscriptions > 0) {
    warnings.push(
      activeSubscriptions === 1
        ? "1 paying member gets free access until the date they paid for, then needs to subscribe again."
        : `${activeSubscriptions} paying members get free access until the date they paid for, then need to subscribe again.`,
    );
  }
  return {
    schemaVersion: manifest.schemaVersion,
    cohoryVersion: manifest.cohoryVersion,
    edition: manifest.edition,
    exportedAt: manifest.exportedAt,
    community: manifest.community,
    counts: manifest.counts,
    uploads: manifest.uploads,
    missingUploads: manifest.missingUploads.length,
    people: {
      total: emails.length,
      existing,
      new: emails.length - existing,
      keptApart,
      inviteOnly: runtime.fairUse.edition === "cloud",
    },
    activeSubscriptions,
    plans: records.membership_plans.length,
    warnings,
  };
}

async function importerLimitWarning(
  runtime: Runtime,
  community: Community,
  incoming: number,
): Promise<string[]> {
  const limits = await memberLimits(runtime, community);
  if (fitsMemberCapacity(limits, incoming)) return [];
  return [
    `The files have ${incoming} members. This community allows ${limits.members ?? 0}, including you. Upgrade or remove rows before you import.`,
  ];
}

export function createMigrationService(deps: MigrationDeps) {
  const runtime = createRuntime(deps);

  async function enqueue(name: MigrationJobName, communityId: string, jobId: string) {
    await runtime.queue.enqueue(name, { jobId, communityId });
  }

  async function requireJob(communityId: string, jobId: string) {
    const parsed = z.uuid().safeParse(jobId);
    const job = parsed.success ? await runtime.jobs.get(communityId, parsed.data) : null;
    if (!job) {
      throw new MigrationNotFoundError("job");
    }
    return job;
  }

  return {
    async startExport(actor: Actor, communityId: string): Promise<MigrationJobView> {
      const { user, community } = await authorize(runtime, actor, communityId, "export");
      if (await runtime.jobs.hasActive(community.id, "export")) {
        throw new MigrationError("job_in_progress", "An export is already running.");
      }
      const job = await runtime.jobs.create(community.id, {
        kind: "export",
        status: "queued",
        requestedBy: user.userId,
      });
      await enqueue(migrationExportJob, community.id, job.id);
      return toJobView(job);
    },

    async listJobs(actor: Actor, communityId: string): Promise<MigrationJobView[]> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      return (await runtime.jobs.list(community.id)).map(toJobView);
    },

    async getJob(actor: Actor, communityId: string, jobId: string): Promise<MigrationJobView> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      return toJobView(await requireJob(community.id, jobId));
    },

    async openExport(actor: Actor, communityId: string, jobId: string): Promise<ExportDownload> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      const job = await requireJob(community.id, jobId);
      if (job.kind !== "export" || job.status !== "succeeded" || !job.fileKey) {
        throw new MigrationNotFoundError("file");
      }
      const object = await runtime.archiveStorage.get(archiveKey(community.id, "exports", job.id));
      if (!object) {
        throw new MigrationNotFoundError("file");
      }
      return {
        filename: job.fileName ?? `${community.slug}-archive.zip`,
        size: object.size,
        body: object.body,
      };
    },

    async deleteExport(
      actor: Actor,
      communityId: string,
      jobId: string,
    ): Promise<MigrationJobView> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      const job = await requireJob(community.id, jobId);
      if (job.kind !== "export") {
        throw new MigrationNotFoundError("job");
      }
      if (job.deletedAt) return toJobView(job);
      const deleted = await runtime.jobs.transition(community.id, job.id, ["succeeded", "failed"], {
        status: job.status,
        fileKey: null,
        deletedAt: runtime.now(),
      });
      if (!deleted) {
        throw new MigrationError("job_in_progress", "Wait for the export to finish.");
      }
      await deleteStoredFile(runtime, job.fileKey);
      return toJobView(deleted);
    },

    async discardPreview(actor: Actor, communityId: string, jobId: string): Promise<void> {
      const { community } = await authorize(runtime, actor, communityId, "import");
      const job = await requireJob(community.id, jobId);
      if (job.kind === "export") {
        throw new MigrationNotFoundError("job");
      }
      const removed = await runtime.jobs.remove(community.id, job.id, ["ready"]);
      if (!removed) {
        throw new MigrationError("job_not_ready", "This import already started.");
      }
      await deleteStoredFile(runtime, removed.fileKey);
    },

    async importReport(actor: Actor, communityId: string, jobId: string): Promise<MigrationReport> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      const view = toJobView(await requireJob(community.id, jobId));
      if (view.kind === "export") {
        throw new MigrationNotFoundError("job");
      }
      if (view.status !== "succeeded" && view.status !== "failed") {
        throw new MigrationError("job_not_ready", "The report is ready when the import ends.");
      }
      return buildImportReport(view);
    },

    async importAvailability(
      actor: Actor,
      communityId: string,
    ): Promise<{ readonly available: boolean; readonly reason: string | null }> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      if (community.archivedAt) {
        return { available: false, reason: "Restore the community before you import into it." };
      }
      try {
        await assertFreshCommunity(runtime, community.id, user.userId);
        return { available: true, reason: null };
      } catch (error: unknown) {
        if (error instanceof MigrationError && error.code === "community_not_empty") {
          return { available: false, reason: error.message };
        }
        throw error;
      }
    },

    async uploadImport(
      actor: Actor,
      communityId: string,
      file: { readonly bytes: Uint8Array; readonly name: string },
    ): Promise<MigrationJobView> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      assertCommunityWritable(community);
      await assertFreshCommunity(runtime, community.id, user.userId);
      const archive = readArchive(file.bytes, {
        maxBytes: runtime.config.archiveMaxBytes,
        maxUploadBytes: runtime.config.archiveMaxBytes,
      });
      const preview = await previewArchive(runtime, community, user.userId, archive);
      const id = newId();
      const key = archiveKey(community.id, "imports", id);
      await runtime.archiveStorage.put({ key, body: file.bytes, contentType: "application/zip" });
      const job = await runtime.jobs.create(community.id, {
        id,
        kind: "import",
        status: "ready",
        requestedBy: user.userId,
        fileKey: key,
        fileName: file.name.slice(0, 200),
        fileBytes: file.bytes.byteLength,
        preview,
        expiresAt: expiresAfter(runtime, previewLifetimeDays),
      });
      return toJobView(job);
    },

    async uploadPlatformImport(
      actor: Actor,
      communityId: string,
      importerId: string,
      files: readonly ImportFile[],
    ): Promise<MigrationJobView> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      if (!isImporterId(importerId)) {
        throw new MigrationError("validation_failed", "Choose Skool or Circle.", [
          { path: "importer", message: "Choose Skool or Circle." },
        ]);
      }
      assertCommunityWritable(community);
      await assertFreshCommunity(runtime, community.id, user.userId);
      const built = await buildPlatformImport(runtime, community, importerId, files);
      const preview = await previewArchive(runtime, community, user.userId, built.archive);
      const catalog = importerCatalog[importerId];
      const limitWarning = await importerLimitWarning(
        runtime,
        community,
        built.archive.records.memberships.length,
      );
      const id = newId();
      const key = archiveKey(community.id, "imports", id);
      await runtime.archiveStorage.put({ key, body: built.bytes, contentType: "application/zip" });
      const job = await runtime.jobs.create(community.id, {
        id,
        kind: "import",
        status: "ready",
        requestedBy: user.userId,
        fileKey: key,
        fileName: built.fileName,
        fileBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
        expiresAt: expiresAfter(runtime, previewLifetimeDays),
        preview: {
          ...preview,
          warnings: [
            ...built.report.warnings,
            ...limitWarning,
            ...preview.warnings.filter((warning) => !warning.startsWith("The archive has")),
          ],
          source: {
            ...built.report,
            name: catalog.name,
            limitsPath: catalog.limitsPath,
            overMemberLimit: limitWarning.length > 0,
          },
        } satisfies ImportPreview,
      });
      return toJobView(job);
    },

    async confirmImport(
      actor: Actor,
      communityId: string,
      jobId: string,
      input: unknown,
    ): Promise<MigrationJobView> {
      const { community, user } = await authorize(runtime, actor, communityId, "import");
      assertCommunityWritable(community);
      const options = parse(confirmImportInputSchema, input);
      const job = await requireJob(community.id, jobId);
      if (job.kind !== "import") {
        throw new MigrationNotFoundError("job");
      }
      await assertFreshCommunity(runtime, community.id, user.userId);
      const view = toJobView(job);
      const source = view.kind === "import" ? view.preview?.source : undefined;
      assertAuthorChoices(options.authors, source?.ambiguousAuthors ?? []);
      if (view.kind === "import" && view.preview?.source) {
        const incoming = view.preview.counts["memberships"] ?? 0;
        assertMemberCapacity(await memberLimits(runtime, community), incoming);
      }
      const queued = await runtime.jobs.transition(community.id, job.id, ["ready"], {
        status: "queued",
        options: { authors: options.authors, ...(options.note ? { note: options.note } : {}) },
        emailChoice: options.emailChoice ?? (options.notifyNewUsers ? "now" : "never"),
      });
      if (!queued) {
        throw new MigrationError("job_not_ready", "This import was already started.");
      }
      await enqueue(migrationImportJob, community.id, job.id);
      return toJobView(queued);
    },

    async sendImportEmails(
      actor: Actor,
      communityId: string,
      jobId: string,
    ): Promise<MigrationJobView> {
      const { community } = await authorize(runtime, actor, communityId, "import");
      assertCommunityWritable(community);
      const job = await requireJob(community.id, jobId);
      if (job.kind !== "import") {
        throw new MigrationNotFoundError("job");
      }
      const claimed = await runtime.jobs.claimLaterEmails(community.id, job.id, runtime.now());
      if (!claimed) {
        throw new MigrationError(
          "job_not_ready",
          "The emails for this import were already sent, or you chose not to send them.",
        );
      }
      await enqueue(migrationImportFinishedJob, community.id, job.id);
      return toJobView(claimed);
    },

    async importEmailPreview(
      actor: Actor,
      communityId: string,
      jobId: string,
      input: unknown,
    ): Promise<EmailContent> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      const { note } = parse(importEmailPreviewInputSchema, input);
      const job = await requireJob(community.id, jobId);
      if (job.kind === "export") {
        throw new MigrationNotFoundError("job");
      }
      return sampleImportEmail(runtime, job, user.userId, note ?? null);
    },

    async sendTestImportEmail(
      actor: Actor,
      communityId: string,
      jobId: string,
      input: unknown,
    ): Promise<void> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      const { note } = parse(importEmailPreviewInputSchema, input);
      const job = await requireJob(community.id, jobId);
      if (job.kind === "export") {
        throw new MigrationNotFoundError("job");
      }
      const to = await userEmail(runtime, community.id, user.userId);
      if (!runtime.mailer || !to) {
        throw new MigrationError("validation_failed", "Email is not set up on this instance.");
      }
      const content = await sampleImportEmail(runtime, job, user.userId, note ?? null);
      await runtime.mailer.send({
        to,
        communityId: community.id,
        ...content,
        subject: `Test: ${content.subject}`,
      });
    },

    async resendableMembers(actor: Actor, communityId: string): Promise<string[]> {
      const { community } = await authorize(runtime, actor, communityId, "import");
      return resendableUserIds(runtime, community.id);
    },

    async resendImportEmail(
      actor: Actor,
      communityId: string,
      userId: string,
    ): Promise<{ readonly sent: boolean }> {
      const { user, community } = await authorize(runtime, actor, communityId, "import");
      assertCommunityWritable(community);
      const parsed = z.uuid().safeParse(userId);
      if (!parsed.success) {
        throw new MigrationNotFoundError("member");
      }
      if (!runtime.mailer) {
        throw new MigrationError("validation_failed", "Email is not set up on this instance.");
      }
      const delivery = await resendImportEmail(runtime, community.id, parsed.data, user.userId);
      return { sent: delivery === "sent" };
    },

    async previewMembersCsv(
      actor: Actor,
      communityId: string,
      file: { readonly bytes: Uint8Array; readonly name: string },
    ): Promise<MigrationJobView> {
      const { user, community } = await authorize(runtime, actor, communityId, "import_members");
      assertCommunityWritable(community);
      if (file.bytes.byteLength > membersCsvMaxBytes) {
        throw new MigrationError("invalid_csv", "The file is larger than 1 MB.");
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      } catch {
        throw new MigrationError("invalid_csv", "Save the file as UTF-8 CSV and try again.");
      }
      const parsed = parseMembersCsv(text, membersCsvMaxRows);
      const preview = await buildMembersPreview(runtime, community, parsed, user.userId);
      const job = await runtime.jobs.create(community.id, {
        kind: "members_csv",
        status: "ready",
        requestedBy: user.userId,
        fileName: file.name.slice(0, 200),
        fileBytes: file.bytes.byteLength,
        preview,
        expiresAt: expiresAfter(runtime, previewLifetimeDays),
      });
      return toJobView(job);
    },

    async confirmMembersCsv(
      actor: Actor,
      communityId: string,
      jobId: string,
      input: unknown,
    ): Promise<MigrationJobView> {
      const { community } = await authorize(runtime, actor, communityId, "import_members");
      assertCommunityWritable(community);
      const options = parse(confirmMembersInputSchema, input);
      const mode: MembersImportMode = options.mode;
      if (mode === "add" && runtime.fairUse.edition !== "community") {
        throw new MigrationError(
          "validation_failed",
          "Adding members directly is for self hosted communities. Send invitations instead.",
          [{ path: "mode", message: "Choose invite." }],
        );
      }
      const job = await requireJob(community.id, jobId);
      if (job.kind !== "members_csv") {
        throw new MigrationNotFoundError("job");
      }
      if (mode === "add") {
        const view = toJobView(job);
        const totals = view.kind === "members_csv" ? view.preview?.totals : undefined;
        const ready = (totals?.ready ?? 0) + (options.resend ? (totals?.invited ?? 0) : 0);
        const limit = await memberLimits(runtime, community);
        if (limit.members !== null && ready > 0) {
          assertMemberCapacity(limit, (await activeMemberCount(runtime, community.id)) + ready - 1);
        }
      }
      const queued = await runtime.jobs.transition(community.id, job.id, ["ready"], {
        status: "queued",
        options: { ...options },
      });
      if (!queued) {
        throw new MigrationError("job_not_ready", "This import was already started.");
      }
      await enqueue(migrationMembersImportJob, community.id, job.id);
      return toJobView(queued);
    },

    async retryJob(actor: Actor, communityId: string, jobId: string): Promise<MigrationJobView> {
      const { community } = await authorize(runtime, actor, communityId, "export");
      const job = await requireJob(community.id, jobId);
      if (job.deletedAt || (job.kind === "members_csv" && !hasPersonalRows(job))) {
        throw new MigrationError("job_not_ready", "Upload the file again.");
      }
      const queued = await runtime.jobs.transition(community.id, job.id, ["failed"], {
        status: "queued",
        errorCode: null,
        finishedAt: null,
      });
      if (!queued) {
        throw new MigrationError("job_not_ready", "Only a failed job can be tried again.");
      }
      const name =
        job.kind === "export"
          ? migrationExportJob
          : job.kind === "import"
            ? migrationImportJob
            : migrationMembersImportJob;
      await enqueue(name, community.id, job.id);
      return toJobView(queued);
    },
  };
}

export type MigrationService = ReturnType<typeof createMigrationService>;
