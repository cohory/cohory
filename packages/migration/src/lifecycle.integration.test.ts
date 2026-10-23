import { ForbiddenError } from "@cohory/authz";
import { communitySlugSchema, createCommunityWithOwner, newId, type Database } from "@cohory/db";
import { memberships, migrationJobs, users } from "@cohory/db/schema";
import { parseStorageKey } from "@cohory/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MigrationError, MigrationNotFoundError } from "./errors";
import { fixtureFiles } from "./importers/fixtures";
import {
  expireMigrationFiles,
  exportLifetimeDays,
  previewLifetimeDays,
  stuckJobHours,
} from "./lifecycle";
import { runExportJob, runImportJob, runMembersImportJob } from "./runner";
import { createRuntime } from "./runtime";
import { createMigrationService } from "./service";
import {
  createScratchDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const start = new Date("2026-10-20T10:00:00.000Z");

let database: TestDatabase;
let files: TempStorage;
let clock = start;

beforeAll(async () => {
  database = await createScratchDatabase("cohory_mig_lifecycle");
  files = await tempStorage();
});

afterAll(async () => {
  await database?.close();
  await files?.remove();
});

async function ownedCommunity(db: Database) {
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${newId()}@example.test`, name: "Owner" })
    .returning({ id: users.id });
  if (!owner) throw new Error("owner insert failed");
  const created = await createCommunityWithOwner(db, {
    ownerUserId: owner.id,
    slug: communitySlugSchema.parse(`life-${newId().slice(-12)}`),
    name: "Lifecycle",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  return {
    actor: { kind: "user" as const, userId: owner.id, platformAdmin: false },
    communityId: created.community.id,
  };
}

async function adminOf(db: Database, communityId: string) {
  const [admin] = await db
    .insert(users)
    .values({ email: `admin-${newId()}@example.test`, name: "Admin" })
    .returning({ id: users.id });
  if (!admin) throw new Error("admin insert failed");
  await db.insert(memberships).values({
    communityId,
    userId: admin.id,
    role: "admin",
    status: "active",
    joinedAt: start,
  });
  return { kind: "user" as const, userId: admin.id, platformAdmin: false };
}

function setup() {
  clock = start;
  const base = testRuntime(database.probe, { archives: files.driver, content: files.driver });
  const deps = { ...base.deps, now: () => clock };
  return { deps, runtime: createRuntime(deps), service: createMigrationService(deps) };
}

async function jobRow(id: string) {
  const [row] = await database.admin.select().from(migrationJobs).where(eq(migrationJobs.id, id));
  return row ?? null;
}

async function stored(key: string | null | undefined): Promise<boolean> {
  if (!key) return false;
  return (await files.driver.get(parseStorageKey(key))) !== null;
}

describe("stored migration files", () => {
  it("lets the owner discard a preview, which deletes its file and the job", async () => {
    const { service } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const preview = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    const row = await jobRow(preview.id);
    expect(row?.expiresAt).toEqual(new Date(start.getTime() + previewLifetimeDays * dayMs));
    expect(await stored(row?.fileKey)).toBe(true);

    await service.discardPreview(actor, communityId, preview.id);

    expect(await jobRow(preview.id)).toBeNull();
    expect(await stored(row?.fileKey)).toBe(false);
  });

  it("refuses to discard for an admin, in another community, or once the import started", async () => {
    const { service } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const other = await ownedCommunity(database.admin);
    const preview = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    const admin = await adminOf(database.admin, communityId);

    await expect(service.discardPreview(admin, communityId, preview.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.discardPreview(other.actor, other.communityId, preview.id),
    ).rejects.toBeInstanceOf(MigrationNotFoundError);

    await database.admin.delete(memberships).where(eq(memberships.userId, admin.userId));
    await service.confirmImport(actor, communityId, preview.id, {});
    await expect(service.discardPreview(actor, communityId, preview.id)).rejects.toMatchObject({
      code: "job_not_ready",
    });
    expect((await jobRow(preview.id))?.status).toBe("queued");
  });

  it("keeps an export for 30 days and lets the owner delete it", async () => {
    const { service, runtime } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const admin = await adminOf(database.admin, communityId);
    const started = await service.startExport(actor, communityId);
    await runExportJob(runtime, { jobId: started.id, communityId });
    const row = await jobRow(started.id);
    expect(row?.expiresAt).toEqual(new Date(start.getTime() + exportLifetimeDays * dayMs));
    expect(await stored(row?.fileKey)).toBe(true);

    await expect(service.deleteExport(admin, communityId, started.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const deleted = await service.deleteExport(actor, communityId, started.id);

    expect(deleted).toMatchObject({ kind: "export", downloadable: false, deletedAt: clock });
    expect(await stored(row?.fileKey)).toBe(false);
    await expect(service.openExport(actor, communityId, started.id)).rejects.toBeInstanceOf(
      MigrationNotFoundError,
    );
    const history = await service.listJobs(actor, communityId);
    expect(history.find((job) => job.id === started.id)?.summary).not.toBeNull();
  });

  it("deletes expired previews and export files in a sweep and leaves fresh ones", async () => {
    const { service, runtime, deps } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const exported = await service.startExport(actor, communityId);
    await runExportJob(runtime, { jobId: exported.id, communityId });
    const oldPreview = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    const csv = await service.previewMembersCsv(actor, communityId, {
      name: "members.csv",
      bytes: new TextEncoder().encode("email\nada@example.test\n"),
    });
    const exportKey = (await jobRow(exported.id))?.fileKey;
    const previewKey = (await jobRow(oldPreview.id))?.fileKey;

    clock = new Date(start.getTime() + (previewLifetimeDays + 1) * dayMs);
    const fresh = await service.uploadPlatformImport(
      actor,
      communityId,
      "circle",
      fixtureFiles("circle"),
    );
    const early = await expireMigrationFiles(createRuntime(deps), [communityId]);
    expect(early).toEqual({ previews: 2, files: 0, stuck: 0 });
    expect(await jobRow(oldPreview.id)).toBeNull();
    expect(await jobRow(csv.id)).toBeNull();
    expect(await stored(previewKey)).toBe(false);
    expect(await jobRow(fresh.id)).not.toBeNull();
    expect(await stored(exportKey)).toBe(true);

    clock = new Date(start.getTime() + (exportLifetimeDays + 1) * dayMs);
    const late = await expireMigrationFiles(createRuntime(deps), [communityId]);
    expect(late).toEqual({ previews: 1, files: 1, stuck: 0 });
    const expiredExport = await jobRow(exported.id);
    expect(expiredExport).toMatchObject({ status: "succeeded", fileKey: null, deletedAt: clock });
    expect(await stored(exportKey)).toBe(false);
  });

  it("writes a report with what moved, what was skipped, and the emails sent", async () => {
    const { service, runtime } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const preview = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    await expect(service.importReport(actor, communityId, preview.id)).rejects.toBeInstanceOf(
      MigrationError,
    );
    await service.confirmImport(actor, communityId, preview.id, {});
    await runImportJob(runtime, { jobId: preview.id, communityId });
    expect((await jobRow(preview.id))?.expiresAt).toBeNull();

    const report = await service.importReport(actor, communityId, preview.id);

    expect(report.filename).toBe("skool-import-report-2026-10-20.csv");
    const lines = report.csv.split("\r\n");
    expect(lines[0]).toBe("type,name,value,detail");
    expect(lines).toContain("source,Skool,,");
    expect(lines).toContain("imported,posts,3,");
    expect(lines).toContain("emails,sent,0,");
    expect(lines).toContain("skipped,members.csv,line 5,The email is missing or not valid.");
    expect(lines.some((line) => line.startsWith("skipped,total,"))).toBe(true);
  });

  it("lets a confirm that races the sweep fail instead of pointing at a deleted file", async () => {
    const { service, deps } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const preview = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    clock = new Date(start.getTime() + (previewLifetimeDays + 1) * dayMs);
    let confirm: Promise<unknown> = Promise.resolve();
    const archives = {
      ...files.driver,
      delete: async (key: Parameters<typeof files.driver.delete>[0]) => {
        confirm = service.confirmImport(actor, communityId, preview.id, {}).catch(() => null);
        await confirm;
        return files.driver.delete(key);
      },
    };

    await expireMigrationFiles(createRuntime({ ...deps, archiveStorage: archives }), [communityId]);
    await confirm;

    expect(await jobRow(preview.id)).toBeNull();
  });
});

const csvRows = (...emails: string[]) => ({
  name: "members.csv",
  bytes: new TextEncoder().encode(["email,name", ...emails.map((e) => `${e},Someone`)].join("\n")),
});

async function confirmedCsv(service: ReturnType<typeof setup>["service"], address: string) {
  const { actor, communityId } = await ownedCommunity(database.admin);
  const job = await service.previewMembersCsv(actor, communityId, csvRows(address));
  await service.confirmMembersCsv(actor, communityId, job.id, { mode: "invite", notify: false });
  return { actor, communityId, jobId: job.id };
}

function holdsEmail(value: unknown, address: string): boolean {
  return JSON.stringify(value).includes(address);
}

describe("personal data in finished jobs", () => {
  it("clears the rows of a members spreadsheet whose import fails, in the row and the jobs list", async () => {
    const { service, runtime } = setup();
    const address = `fail-${newId()}@example.test`;
    const { actor, communityId, jobId } = await confirmedCsv(service, address);
    const [stranger] = await database.admin
      .insert(users)
      .values({ email: `stranger-${newId()}@example.test`, name: "Stranger" })
      .returning({ id: users.id });
    await database.admin
      .update(migrationJobs)
      .set({ requestedBy: stranger?.id })
      .where(eq(migrationJobs.id, jobId));

    await expect(runMembersImportJob(runtime, { jobId, communityId })).rejects.toBeInstanceOf(
      MigrationError,
    );

    const row = await jobRow(jobId);
    expect(row?.status).toBe("failed");
    expect(holdsEmail(row?.preview, address)).toBe(false);
    expect(holdsEmail(await service.listJobs(actor, communityId), address)).toBe(false);
    await expect(service.retryJob(actor, communityId, jobId)).rejects.toMatchObject({
      code: "job_not_ready",
    });
  });

  it("clears the rows of an expired failed members spreadsheet in the sweep", async () => {
    const { service, deps } = setup();
    const address = `expired-${newId()}@example.test`;
    const { actor, communityId, jobId } = await confirmedCsv(service, address);
    await database.admin
      .update(migrationJobs)
      .set({ status: "failed", errorCode: "internal_error" })
      .where(eq(migrationJobs.id, jobId));
    expect(holdsEmail((await jobRow(jobId))?.preview, address)).toBe(true);

    clock = new Date(start.getTime() + (previewLifetimeDays + 1) * dayMs);
    await expireMigrationFiles(createRuntime(deps), [communityId]);

    const row = await jobRow(jobId);
    expect(row?.deletedAt).toEqual(clock);
    expect(holdsEmail(row?.preview, address)).toBe(false);
    expect(holdsEmail(await service.listJobs(actor, communityId), address)).toBe(false);
  });

  it("fails a job left running after a worker crash and clears its rows, but leaves a recent one", async () => {
    const { service, deps } = setup();
    const address = `stuck-${newId()}@example.test`;
    const stuck = await confirmedCsv(service, address);
    const recent = await confirmedCsv(service, `recent-${newId()}@example.test`);
    clock = new Date(start.getTime() + 2 * dayMs);
    await database.admin
      .update(migrationJobs)
      .set({
        status: "running",
        startedAt: new Date(clock.getTime() - (stuckJobHours + 1) * hourMs),
      })
      .where(eq(migrationJobs.id, stuck.jobId));
    await database.admin
      .update(migrationJobs)
      .set({ status: "running", startedAt: new Date(clock.getTime() - hourMs) })
      .where(eq(migrationJobs.id, recent.jobId));

    const swept = await expireMigrationFiles(createRuntime(deps), [
      stuck.communityId,
      recent.communityId,
    ]);

    expect(swept.stuck).toBe(1);
    const row = await jobRow(stuck.jobId);
    expect(row).toMatchObject({ status: "failed", errorCode: "internal_error", finishedAt: clock });
    expect(holdsEmail(row?.preview, address)).toBe(false);
    expect((await jobRow(recent.jobId))?.status).toBe("running");
  });

  it("refuses to try a deleted export again, so its file cannot come back", async () => {
    const { service } = setup();
    const { actor, communityId } = await ownedCommunity(database.admin);
    const started = await service.startExport(actor, communityId);
    await database.admin
      .update(migrationJobs)
      .set({ status: "failed", errorCode: "internal_error" })
      .where(eq(migrationJobs.id, started.id));
    await service.deleteExport(actor, communityId, started.id);

    await expect(service.retryJob(actor, communityId, started.id)).rejects.toMatchObject({
      code: "job_not_ready",
    });
    expect((await jobRow(started.id))?.status).toBe("failed");
  });
});
