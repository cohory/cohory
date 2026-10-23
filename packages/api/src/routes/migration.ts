import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import {
  membersCsvMaxBytes,
  migrationNoteMaxLength,
  parseMigrationEnv,
  type MigrationJobView,
  type MigrationService,
} from "@cohory/migration";
import { clientIp, type RateLimiter } from "@cohory/rate-limit";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type ActorVariables, type SessionResolver } from "../middleware/session";
import { errorResponse, json, slugParams, tooManyRequests } from "./posts-schemas";

const jsonLimit = bodyLimit({ maxSize: 64 * 1024 });

export interface MigrationRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  migration: MigrationService;
  rateLimiter: RateLimiter;
}

const security = [{ sessionCookie: [] }];
const tags = ["Migration"];
const base = "/communities/{slug}/manage/migration";
const ownerOnly = " Owner only.";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("Only the owner can do this."),
  404: errorResponse("The community or job does not exist or is not visible to the caller."),
  409: errorResponse("The community is not empty or archived, or the job already started."),
  422: errorResponse("The file or the input is invalid."),
};

const progressSchema = z.object({
  phase: z.string(),
  done: z.int(),
  total: z.int(),
});

export const migrationJobSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["export", "import", "members_csv"]),
    status: z.enum(["ready", "queued", "running", "succeeded", "failed"]),
    fileName: z.string().nullable(),
    fileBytes: z.int().nullable(),
    progress: progressSchema.nullable(),
    preview: z.record(z.string(), z.unknown()).nullable().openapi({
      description: "Import preview: archive counts, people, and warnings; or CSV rows.",
    }),
    summary: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: "Result counts, skipped items, and subscriptions to link." }),
    errorCode: z.string().nullable(),
    downloadable: z.boolean(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable().openapi({
      description:
        "When the stored file and preview are deleted: 7 days after a preview, 30 days after an export.",
    }),
    deletedAt: z.iso.datetime().nullable().openapi({
      description:
        "When the owner or the expiry job deleted the export file. The row stays as history.",
    }),
    emailChoice: z.enum(["now", "later", "never"]).nullable().openapi({
      description: "For imports: when people are emailed, as the owner chose on confirm.",
    }),
    emailsSentAt: z.iso.datetime().nullable().openapi({
      description: "When the import emails were sent or requested. Null while they wait.",
    }),
  })
  .openapi("MigrationJob");

const jobListSchema = z
  .object({ data: z.array(migrationJobSchema), ...pageCursor })
  .openapi("MigrationJobList");

const jobParams = slugParams.extend({
  jobId: z.uuid().openapi({ param: { name: "jobId", in: "path" } }),
});

const fileFormSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, { message: "Attach a file." })
    .openapi({ type: "string", format: "binary" }),
});

const noteSchema = z
  .string()
  .max(migrationNoteMaxLength)
  .optional()
  .openapi({
    description: `A short note from the owner added to every email, as plain text without links. Up to ${migrationNoteMaxLength} characters.`,
  });

const confirmImportBodySchema = z
  .object({
    emailChoice: z.enum(["now", "later", "never"]).optional().openapi({
      description:
        "now emails everyone when the import finishes, later waits until the owner sends the emails from the import history, never sends nothing. New accounts get a single use link to choose a password; on Cloud, and for unconfirmed accounts on the Community Edition, people get a single use invitation instead. Defaults to never.",
    }),
    notifyNewUsers: z.boolean().optional().openapi({
      description: "Deprecated. true is the same as emailChoice now.",
    }),
    note: noteSchema,
    authors: z.record(z.string().max(64), z.string().max(64)).optional().openapi({
      description:
        "For platform imports: maps the placeholderId of an author name that matches more than one member to the id of the member who wrote those posts. Names left out keep their posts under the name marked as former member.",
    }),
  })
  .openapi("ConfirmArchiveImportInput");

const confirmMembersBodySchema = z
  .object({
    mode: z.enum(["invite", "add"]).openapi({
      description:
        "invite emails a single use invite link to each row. add creates active memberships directly (Community Edition only).",
    }),
    notify: z.boolean().optional().openapi({ description: "In add mode, email each person." }),
    resend: z.boolean().optional().openapi({
      description:
        "Also include rows marked invited, who already have an open invitation from an earlier upload.",
    }),
    note: noteSchema,
  })
  .openapi("ConfirmMembersImportInput");

const emailNoteBodySchema = z.object({ note: noteSchema }).openapi("ImportEmailNoteInput");

const emailPreviewSchema = z
  .object({ subject: z.string(), text: z.string(), html: z.string() })
  .openapi("ImportEmailPreview");

const memberParams = slugParams.extend({
  userId: z.uuid().openapi({ param: { name: "userId", in: "path" } }),
});

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function migrationJobJson(view: MigrationJobView): z.infer<typeof migrationJobSchema> {
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    fileName: view.fileName,
    fileBytes: view.fileBytes,
    progress: view.progress ? { ...view.progress } : null,
    preview: view.preview ? { ...view.preview } : null,
    summary: view.summary ? { ...view.summary } : null,
    errorCode: view.errorCode,
    downloadable: view.downloadable,
    createdAt: view.createdAt.toISOString(),
    startedAt: iso(view.startedAt),
    finishedAt: iso(view.finishedAt),
    expiresAt: iso(view.expiresAt),
    deletedAt: iso(view.deletedAt),
    emailChoice: view.emailChoice,
    emailsSentAt: iso(view.emailsSentAt),
  };
}

const listJobs = createRoute({
  method: "get",
  path: `${base}/jobs`,
  operationId: "listMigrationJobs",
  "x-cohory": routeMeta("listMigrationJobs"),
  tags,
  security,
  summary: "List migration jobs",
  description: `The 20 most recent exports, archive imports, and member CSV imports, newest first.${ownerOnly}`,
  request: { params: slugParams },
  responses: { 200: json(jobListSchema, "The jobs."), ...errors },
});

const getJob = createRoute({
  method: "get",
  path: `${base}/jobs/{jobId}`,
  operationId: "getMigrationJob",
  "x-cohory": routeMeta("getMigrationJob"),
  tags,
  security,
  summary: "Get a migration job",
  description: `Status, progress, preview, and result of one job. Poll it while the job runs.${ownerOnly}`,
  request: { params: jobParams },
  responses: { 200: json(migrationJobSchema, "The job."), ...errors },
});

const retryJob = createRoute({
  method: "post",
  path: `${base}/jobs/{jobId}/retry`,
  operationId: "retryMigrationJob",
  "x-cohory": routeMeta("retryMigrationJob"),
  tags,
  security,
  summary: "Retry a failed migration job",
  description: `Queues a failed job again. Imports continue where they stopped, without duplicates.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: jobParams },
  responses: { 200: json(migrationJobSchema, "The queued job."), ...errors },
});

const startExport = createRoute({
  method: "post",
  path: `${base}/exports`,
  operationId: "startArchiveExport",
  "x-cohory": routeMeta("startArchiveExport"),
  tags,
  security,
  summary: "Export the community archive",
  description: `Queues a full archive export (format 1.0.0, see docs/architecture/archive-format.md). The worker writes a zip with a manifest, JSON lines per entity, and uploads. Written to the audit log.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams },
  responses: { 201: json(migrationJobSchema, "The queued export."), ...errors },
});

const downloadExport = createRoute({
  method: "get",
  path: `${base}/exports/{jobId}/download`,
  operationId: "downloadArchiveExport",
  "x-cohory": routeMeta("downloadArchiveExport"),
  tags,
  security,
  summary: "Download an exported archive",
  description: `The zip written by a finished export.${ownerOnly}`,
  request: { params: jobParams },
  responses: {
    200: {
      description: "The archive.",
      content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
    },
    ...errors,
  },
});

const deleteExport = createRoute({
  method: "delete",
  path: `${base}/exports/{jobId}`,
  operationId: "deleteArchiveExport",
  "x-cohory": routeMeta("deleteArchiveExport"),
  tags,
  security,
  summary: "Delete an exported archive",
  description: `Deletes the zip of a finished or failed export. The job stays in the history with \`deletedAt\`. Exports are also deleted 30 days after they finish.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: jobParams },
  responses: { 200: json(migrationJobSchema, "The export without its file."), ...errors },
});

const discardPreview = createRoute({
  method: "delete",
  path: `${base}/jobs/{jobId}`,
  operationId: "discardMigrationPreview",
  "x-cohory": routeMeta("discardMigrationPreview"),
  tags,
  security,
  summary: "Discard an import preview",
  description: `Deletes an import or members CSV job that is waiting for confirmation, with its stored file. A preview that is not confirmed is also deleted after 7 days. A started import answers 409.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: jobParams },
  responses: { 204: { description: "The preview and its file are gone." }, ...errors },
});

const downloadReport = createRoute({
  method: "get",
  path: `${base}/jobs/{jobId}/report`,
  operationId: "downloadMigrationReport",
  "x-cohory": routeMeta("downloadMigrationReport"),
  tags,
  security,
  summary: "Download an import report",
  description: `A CSV report of a finished archive, platform, or members CSV import, with the columns type, name, value, and detail: the source, the status, counts per kind of record, accounts created and linked, emails sent, the skipped total, each listed skipped row with its reason (up to 200), and warnings.${ownerOnly}`,
  request: { params: jobParams },
  responses: {
    200: {
      description: "The report.",
      content: { "text/csv": { schema: z.string() } },
    },
    ...errors,
  },
});

const uploadImport = createRoute({
  method: "post",
  path: `${base}/imports`,
  operationId: "uploadArchiveImport",
  "x-cohory": routeMeta("uploadArchiveImport"),
  tags,
  security,
  summary: "Upload an archive to import",
  description: `Validates the zip in the \`file\` field (manifest, schema version, checksums, every line) and returns a preview. Nothing is imported until you confirm. The community must be empty: no posts, courses, events, or members other than the owner.${ownerOnly}`,
  middleware: [
    (c, next) => bodyLimit({ maxSize: parseMigrationEnv().archiveMaxBytes + 64 * 1024 })(c, next),
  ] as const,
  request: {
    params: slugParams,
    body: { required: true, content: { "multipart/form-data": { schema: fileFormSchema } } },
  },
  responses: {
    201: json(migrationJobSchema, "The validated import."),
    429: tooManyRequests,
    ...errors,
  },
});

const confirmImport = createRoute({
  method: "post",
  path: `${base}/imports/{jobId}/confirm`,
  operationId: "confirmArchiveImport",
  "x-cohory": routeMeta("confirmArchiveImport"),
  tags,
  security,
  summary: "Start an archive import",
  description: `Queues a validated import. The worker restores members, content, courses, events, points, and comped access, then reports anything it skipped.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: {
    params: jobParams,
    body: { required: true, content: { "application/json": { schema: confirmImportBodySchema } } },
  },
  responses: { 200: json(migrationJobSchema, "The queued import."), ...errors },
});

const previewMembers = createRoute({
  method: "post",
  path: `${base}/members-csv`,
  operationId: "previewMembersCsv",
  "x-cohory": routeMeta("previewMembersCsv"),
  tags,
  security,
  summary: "Upload a members CSV",
  description: `Reads a UTF-8 CSV in the \`file\` field, up to 5000 rows and 1 MB. The email column may be named Email, Email address, or E-mail; without one, the column whose values are email addresses is used. Optional columns: name (or first name and last name), role (member, moderator, admin), and status (rows that are not active are left out). Returns every row with its status or error, and marks people who already have an open invitation as invited. Nothing changes until you confirm.${ownerOnly}`,
  middleware: [bodyLimit({ maxSize: membersCsvMaxBytes + 64 * 1024 })] as const,
  request: {
    params: slugParams,
    body: { required: true, content: { "multipart/form-data": { schema: fileFormSchema } } },
  },
  responses: { 201: json(migrationJobSchema, "The preview."), 429: tooManyRequests, ...errors },
});

const confirmMembers = createRoute({
  method: "post",
  path: `${base}/members-csv/{jobId}/confirm`,
  operationId: "confirmMembersCsv",
  "x-cohory": routeMeta("confirmMembersCsv"),
  tags,
  security,
  summary: "Import the members CSV",
  description: `Queues the import of the rows that passed validation. Invite mode emails a single use invite link that expires in 30 days. Add mode creates active memberships and is only for self hosted communities. Fair use member limits apply.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: {
    params: jobParams,
    body: { required: true, content: { "application/json": { schema: confirmMembersBodySchema } } },
  },
  responses: { 200: json(migrationJobSchema, "The queued import."), ...errors },
});

const sendEmails = createRoute({
  method: "post",
  path: `${base}/imports/{jobId}/emails`,
  operationId: "sendImportEmails",
  "x-cohory": routeMeta("sendImportEmails"),
  tags,
  security,
  summary: "Send the import emails",
  description: `Sends the emails of a finished import whose owner chose to send them later: a link to choose a password for new accounts, or an invitation for people kept apart. Works once per import; people who already got an email or set a password are left out, and addresses that opted out or bounced are counted as not sent.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: jobParams },
  responses: {
    200: json(migrationJobSchema, "The import with the emails on their way."),
    ...errors,
  },
});

const previewEmail = createRoute({
  method: "post",
  path: `${base}/jobs/{jobId}/email-preview`,
  operationId: "previewImportEmail",
  "x-cohory": routeMeta("previewImportEmail"),
  tags,
  security,
  summary: "Preview the import email",
  description: `Renders the email people get from this import or members CSV, with the note, addressed to the owner and with a sample link. Nothing is sent.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: {
    params: jobParams,
    body: { required: true, content: { "application/json": { schema: emailNoteBodySchema } } },
  },
  responses: { 200: json(emailPreviewSchema, "The email."), ...errors },
});

const testEmail = createRoute({
  method: "post",
  path: `${base}/jobs/{jobId}/test-email`,
  operationId: "sendTestImportEmail",
  "x-cohory": routeMeta("sendTestImportEmail"),
  tags,
  security,
  summary: "Send a test of the import email",
  description: `Sends the preview to the owner's own address, with "Test:" in front of the subject and a sample link.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: {
    params: jobParams,
    body: { required: true, content: { "application/json": { schema: emailNoteBodySchema } } },
  },
  responses: { 204: { description: "The test is on its way." }, 429: tooManyRequests, ...errors },
});

const resendEmail = createRoute({
  method: "post",
  path: `${base}/members/{userId}/resend-email`,
  operationId: "resendImportEmail",
  "x-cohory": routeMeta("resendImportEmail"),
  tags,
  security,
  summary: "Resend an imported person's email",
  description: `Sends one imported person their email again: the invitation while it can still be used, or a new link to choose a password. Answers 404 when the person was not imported here, already set a password, or accepted their invitation. \`sent\` is false when the address opted out or bounced.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: memberParams },
  responses: {
    200: json(z.object({ sent: z.boolean() }).openapi("ResendImportEmailResult"), "The result."),
    429: tooManyRequests,
    ...errors,
  },
});

export function createMigrationRoutes(getDeps: () => MigrationRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/manage/migration/*", actor);

  const migration = () => getDeps().migration;
  const limit = (
    c: Context<{ Variables: ActorVariables }>,
    rule: "migrationPreview" | "migrationImport" | "memberImport",
  ) => {
    const caller = c.get("actor");
    const key = caller.kind === "user" ? caller.userId : clientIp(c.req.raw.headers);
    getDeps().rateLimiter.consume(rule, key);
  };

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  async function upload(value: File): Promise<{ bytes: Uint8Array; name: string }> {
    return { bytes: new Uint8Array(await value.arrayBuffer()), name: value.name || "upload" };
  }

  return app
    .openapi(listJobs, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(
        { data: (await migration().listJobs(caller, id)).map(migrationJobJson), nextCursor: null },
        200,
      );
    })
    .openapi(getJob, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(migrationJobJson(await migration().getJob(caller, id, jobId)), 200);
    })
    .openapi(retryJob, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(migrationJobJson(await migration().retryJob(caller, id, jobId)), 200);
    })
    .openapi(startExport, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(migrationJobJson(await migration().startExport(caller, id)), 201);
    })
    .openapi(downloadExport, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const download = await migration().openExport(caller, id, jobId);
      return new Response(download.body, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "Content-Length": String(download.size),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })
    .openapi(deleteExport, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(migrationJobJson(await migration().deleteExport(caller, id, jobId)), 200);
    })
    .openapi(discardPreview, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      await migration().discardPreview(caller, id, jobId);
      return c.body(null, 204);
    })
    .openapi(downloadReport, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const report = await migration().importReport(caller, id, jobId);
      return new Response(report.csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })
    .openapi(uploadImport, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      limit(c, "migrationPreview");
      const view = await migration().uploadImport(
        caller,
        id,
        await upload(c.req.valid("form").file),
      );
      return c.json(migrationJobJson(view), 201);
    })
    .openapi(confirmImport, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      limit(c, "migrationImport");
      const view = await migration().confirmImport(caller, id, jobId, c.req.valid("json"));
      return c.json(migrationJobJson(view), 200);
    })
    .openapi(previewMembers, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      limit(c, "memberImport");
      const view = await migration().previewMembersCsv(
        caller,
        id,
        await upload(c.req.valid("form").file),
      );
      return c.json(migrationJobJson(view), 201);
    })
    .openapi(confirmMembers, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const view = await migration().confirmMembersCsv(caller, id, jobId, c.req.valid("json"));
      return c.json(migrationJobJson(view), 200);
    })
    .openapi(sendEmails, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(migrationJobJson(await migration().sendImportEmails(caller, id, jobId)), 200);
    })
    .openapi(previewEmail, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const email = await migration().importEmailPreview(caller, id, jobId, c.req.valid("json"));
      return c.json({ subject: email.subject, text: email.text, html: email.html }, 200);
    })
    .openapi(testEmail, async (c) => {
      const caller = c.get("actor");
      const { slug, jobId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      limit(c, "memberImport");
      await migration().sendTestImportEmail(caller, id, jobId, c.req.valid("json"));
      return c.body(null, 204);
    })
    .openapi(resendEmail, async (c) => {
      const caller = c.get("actor");
      const { slug, userId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      limit(c, "memberImport");
      return c.json(await migration().resendImportEmail(caller, id, userId), 200);
    });
}
