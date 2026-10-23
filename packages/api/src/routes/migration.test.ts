import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { MigrationError, type MigrationJobView, type MigrationService } from "@cohory/migration";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

type Stub = { [K in keyof MigrationService]: Mock<MigrationService[K]> };

let stub: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let owner: string;

function job(overrides: Partial<MigrationJobView> = {}): MigrationJobView {
  return {
    id: newId(),
    kind: "export",
    status: "queued",
    fileName: null,
    fileBytes: null,
    progress: null,
    preview: null,
    summary: null,
    errorCode: null,
    downloadable: false,
    createdAt: new Date("2026-10-18T10:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    deletedAt: null,
    emailChoice: null,
    emailsSentAt: null,
    ...overrides,
  } as MigrationJobView;
}

beforeEach(() => {
  const repo = createFakeRepository();
  communityId = repo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  }).id;
  owner = newId();
  repo.addMembership({ communityId, userId: owner, role: "owner", status: "active" });
  stub = {
    startExport: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    openExport: vi.fn(),
    uploadImport: vi.fn(),
    confirmImport: vi.fn(),
    previewMembersCsv: vi.fn(),
    confirmMembersCsv: vi.fn(),
    retryJob: vi.fn(),
    importAvailability: vi.fn(),
    uploadPlatformImport: vi.fn(),
    deleteExport: vi.fn(),
    discardPreview: vi.fn(),
    importReport: vi.fn(),
    sendImportEmails: vi.fn(),
    importEmailPreview: vi.fn(),
    sendTestImportEmail: vi.fn(),
    resendableMembers: vi.fn(),
    resendImportEmail: vi.fn(),
  };
  const rateLimiter = createRateLimiter({
    disabled: false,
    rules: {
      ...rateLimitDefaults,
      memberImport: { max: 1, windowSeconds: 60 },
      migrationPreview: { max: 2, windowSeconds: 3600 },
      migrationImport: { max: 1, windowSeconds: 3600 },
    },
  });
  const communities = createCommunitiesService(repo);
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities,
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (key) => key,
        },
      }),
      migration: stub,
      rateLimiter,
    }),
  );
});

function call(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData; user?: string } = {},
) {
  const headers = new Headers();
  if (init.user !== undefined) headers.set(sessionHeader, init.user);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers/manage/migration${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

function form(name: string, content: string, type: string): FormData {
  const data = new FormData();
  data.set("file", new File([content], name, { type }));
  return data;
}

describe("migration routes", () => {
  it("starts an export for the community and returns the queued job", async () => {
    stub.startExport.mockResolvedValue(job());

    const response = await call("/exports", { method: "POST", user: owner });

    expect(response.status).toBe(201);
    expect(stub.startExport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
    );
    expect(await response.json()).toMatchObject({ kind: "export", status: "queued" });
  });

  it("passes guests to the service, which asks them to sign in", async () => {
    stub.listJobs.mockRejectedValue(new UnauthenticatedError());

    const response = await call("/jobs");

    expect(response.status).toBe(401);
    expect(stub.listJobs).toHaveBeenCalledWith({ kind: "guest" }, communityId);
  });

  it("maps a refusal from the service to 403", async () => {
    stub.listJobs.mockRejectedValue(new ForbiddenError("export", "migration"));

    expect((await call("/jobs", { user: owner })).status).toBe(403);
  });

  it("streams a finished archive as a zip attachment", async () => {
    stub.openExport.mockResolvedValue({
      filename: "makers-archive-2026-10-18.zip",
      size: 3,
      body: new Response(new Uint8Array([1, 2, 3])).body ?? new ReadableStream(),
    });

    const response = await call(`/exports/${newId()}/download`, { user: owner });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="makers-archive-2026-10-18.zip"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("passes the uploaded archive bytes to the service and maps a non empty community to 409", async () => {
    stub.uploadImport.mockRejectedValue(
      new MigrationError("community_not_empty", "Import into a new, empty community."),
    );

    const response = await call("/imports", {
      method: "POST",
      user: owner,
      form: form("a.zip", "PK", "application/zip"),
    });

    expect(response.status).toBe(409);
    expect(stub.uploadImport.mock.calls[0]?.[2]).toMatchObject({ name: "a.zip" });
  });

  it("reports archive validation issues as 422 details", async () => {
    stub.uploadImport.mockRejectedValue(
      new MigrationError("invalid_archive", "The archive has invalid data.", [
        { path: "data/posts.jsonl:3", message: "Required" },
      ]),
    );

    const response = await call("/imports", {
      method: "POST",
      user: owner,
      form: form("a.zip", "PK", "application/zip"),
    });
    const body = (await response.json()) as { error: { code: string; details: unknown } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("invalid_archive");
    expect(body.error.details).toEqual([{ path: "data/posts.jsonl:3", message: "Required" }]);
  });

  it("rate limits member CSV uploads", async () => {
    stub.previewMembersCsv.mockResolvedValue(job({ kind: "members_csv", status: "ready" }));
    const upload = () =>
      call("/members-csv", {
        method: "POST",
        user: owner,
        form: form("m.csv", "email\n", "text/csv"),
      });

    expect((await upload()).status).toBe(201);
    expect((await upload()).status).toBe(429);
  });

  it("counts archive previews apart from confirmed imports and says how long to wait", async () => {
    stub.uploadImport.mockResolvedValue(job({ kind: "import", status: "ready" }));
    stub.confirmImport.mockResolvedValue(job({ kind: "import", status: "queued" }));
    const upload = () =>
      call("/imports", {
        method: "POST",
        user: owner,
        form: form("a.zip", "PK", "application/zip"),
      });
    const confirm = () =>
      call(`/imports/${newId()}/confirm`, { method: "POST", user: owner, body: {} });

    expect((await upload()).status).toBe(201);
    expect((await confirm()).status).toBe(200);
    expect((await upload()).status).toBe(201);
    const limited = await upload();
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { message: string } }).error.message).toBe(
      "You're doing that too often. Try again in 60 minutes.",
    );
    expect((await confirm()).status).toBe(429);
    expect(stub.confirmImport).toHaveBeenCalledTimes(1);
  });

  it("deletes an export file for the owner", async () => {
    const deletedAt = new Date("2026-10-19T10:00:00.000Z");
    stub.deleteExport.mockResolvedValue(job({ status: "succeeded", deletedAt }));
    const id = newId();

    const response = await call(`/exports/${id}`, { method: "DELETE", user: owner });

    expect(response.status).toBe(200);
    expect(stub.deleteExport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      id,
    );
    expect(await response.json()).toMatchObject({ deletedAt: deletedAt.toISOString() });
  });

  it("discards a preview and answers 204", async () => {
    stub.discardPreview.mockResolvedValue(undefined);
    const id = newId();

    const response = await call(`/jobs/${id}`, { method: "DELETE", user: owner });

    expect(response.status).toBe(204);
    expect(stub.discardPreview).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      id,
    );
  });

  it("maps discarding a started import to 409", async () => {
    stub.discardPreview.mockRejectedValue(
      new MigrationError("job_not_ready", "This import already started."),
    );

    expect((await call(`/jobs/${newId()}`, { method: "DELETE", user: owner })).status).toBe(409);
  });

  it("downloads the import report as a CSV attachment", async () => {
    stub.importReport.mockResolvedValue({
      filename: "skool-import-report-2026-10-20.csv",
      csv: "type,name,value,detail\r\nsource,Skool,,\r\n",
    });

    const response = await call(`/jobs/${newId()}/report`, { user: owner });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="skool-import-report-2026-10-20.csv"',
    );
    expect(await response.text()).toBe("type,name,value,detail\r\nsource,Skool,,\r\n");
  });

  it("validates the confirm body before calling the service", async () => {
    const response = await call(`/members-csv/${newId()}/confirm`, {
      method: "POST",
      user: owner,
      body: { mode: "everyone" },
    });

    expect(response.status).toBe(422);
    expect(stub.confirmMembersCsv).not.toHaveBeenCalled();
  });

  it("passes the email choice and the note of an import to the service", async () => {
    stub.confirmImport.mockResolvedValue(job({ kind: "import", emailChoice: "later" }));
    const jobId = newId();

    const response = await call(`/imports/${jobId}/confirm`, {
      method: "POST",
      user: owner,
      body: { emailChoice: "later", note: "See you there" },
    });

    expect(response.status).toBe(200);
    expect(stub.confirmImport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      jobId,
      { emailChoice: "later", note: "See you there" },
    );
    expect(await response.json()).toMatchObject({ emailChoice: "later", emailsSentAt: null });
  });

  it("refuses an email choice it does not know and a note that is too long", async () => {
    for (const body of [{ emailChoice: "maybe" }, { note: "x".repeat(501) }]) {
      const response = await call(`/imports/${newId()}/confirm`, {
        method: "POST",
        user: owner,
        body,
      });
      expect(response.status).toBe(422);
    }
    expect(stub.confirmImport).not.toHaveBeenCalled();
  });

  it("sends the emails of an import later and maps a second request to 409", async () => {
    const sentAt = new Date("2026-10-20T10:00:00.000Z");
    stub.sendImportEmails
      .mockResolvedValueOnce(job({ kind: "import", emailChoice: "later", emailsSentAt: sentAt }))
      .mockRejectedValueOnce(new MigrationError("job_not_ready", "Already sent."));
    const jobId = newId();

    const first = await call(`/imports/${jobId}/emails`, { method: "POST", user: owner });
    const second = await call(`/imports/${jobId}/emails`, { method: "POST", user: owner });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ emailsSentAt: sentAt.toISOString() });
    expect(second.status).toBe(409);
  });

  it("previews the import email and sends a rate limited test to the owner", async () => {
    stub.importEmailPreview.mockResolvedValue({
      subject: "[Makers] The community has moved",
      text: "Hi",
      html: "<p>Hi</p>",
      template: "community-moved",
    });
    stub.sendTestImportEmail.mockResolvedValue(undefined);
    const jobId = newId();

    const preview = await call(`/jobs/${jobId}/email-preview`, {
      method: "POST",
      user: owner,
      body: { note: "Hello" },
    });
    const test = await call(`/jobs/${jobId}/test-email`, { method: "POST", user: owner, body: {} });
    const again = await call(`/jobs/${jobId}/test-email`, {
      method: "POST",
      user: owner,
      body: {},
    });

    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      subject: "[Makers] The community has moved",
      text: "Hi",
      html: "<p>Hi</p>",
    });
    expect(stub.importEmailPreview).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      jobId,
      { note: "Hello" },
    );
    expect(test.status).toBe(204);
    expect(again.status).toBe(429);
  });

  it("resends one imported person's email", async () => {
    stub.resendImportEmail.mockResolvedValue({ sent: true });
    const userId = newId();

    const response = await call(`/members/${userId}/resend-email`, {
      method: "POST",
      user: owner,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(stub.resendImportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      userId,
    );
  });
});
