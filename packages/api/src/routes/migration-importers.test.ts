import { ForbiddenError } from "@cohory/authz";
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

const importJob = {
  id: newId(),
  kind: "import",
  status: "ready",
  fileName: "skool-import-2026-10-18.zip",
  fileBytes: 10,
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
} as MigrationJobView;

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
    rules: { ...rateLimitDefaults, migrationPreview: { max: 1, windowSeconds: 60 } },
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

function call(path: string, init: { method?: string; form?: FormData; user?: string } = {}) {
  const headers = new Headers();
  if (init.user !== undefined) headers.set(sessionHeader, init.user);
  return api.request(`/api/v1/communities/makers/manage/migration/importers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form,
  });
}

function files(...names: string[]): FormData {
  const data = new FormData();
  for (const name of names) data.append("files", new File(["email\nada@x.test"], name));
  return data;
}

describe("platform importer routes", () => {
  it("lists both importers with their versions and limits pages", async () => {
    stub.importAvailability.mockResolvedValue({ available: true, reason: null });

    const response = await call("", { user: owner });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; limitsPath: string }[] };
    expect(body.data.map((entry) => [entry.id, entry.limitsPath])).toEqual([
      ["skool", "/importers/skool"],
      ["circle", "/importers/circle"],
    ]);
  });

  it("hides the list from people who are not the owner", async () => {
    stub.importAvailability.mockRejectedValue(new ForbiddenError("import", "migration"));
    expect((await call("", { user: newId() })).status).toBe(403);
  });

  it("passes every uploaded file to the chosen importer", async () => {
    stub.uploadPlatformImport.mockResolvedValue(importJob);

    const response = await call("/skool/uploads", {
      method: "POST",
      user: owner,
      form: files("members.csv", "posts.json"),
    });

    expect(response.status).toBe(201);
    expect(stub.uploadPlatformImport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
      communityId,
      "skool",
      [
        expect.objectContaining({ name: "members.csv" }),
        expect.objectContaining({ name: "posts.json" }),
      ],
    );
    expect(await response.json()).toMatchObject({ kind: "import", status: "ready" });
  });

  it("accepts a single file and rate limits repeated uploads", async () => {
    stub.uploadPlatformImport.mockResolvedValue(importJob);
    const first = await call("/circle/uploads", {
      method: "POST",
      user: owner,
      form: files("members.csv"),
    });
    expect(first.status).toBe(201);
    const second = await call("/circle/uploads", {
      method: "POST",
      user: owner,
      form: files("members.csv"),
    });
    expect(second.status).toBe(429);
  });

  it("rejects unknown platforms, missing files, and too many files", async () => {
    expect(
      (await call("/mighty/uploads", { method: "POST", user: owner, form: files("a.csv") })).status,
    ).toBe(422);
    expect(
      (await call("/skool/uploads", { method: "POST", user: owner, form: new FormData() })).status,
    ).toBe(422);
    const many = files(...Array.from({ length: 9 }, (_, index) => `f${index}.csv`));
    expect((await call("/skool/uploads", { method: "POST", user: owner, form: many })).status).toBe(
      422,
    );
    expect(stub.uploadPlatformImport).not.toHaveBeenCalled();
  });

  it("maps importer errors to plain responses", async () => {
    stub.uploadPlatformImport.mockRejectedValue(
      new MigrationError("community_not_empty", "Import into a new, empty community."),
    );
    const response = await call("/skool/uploads", {
      method: "POST",
      user: owner,
      form: files("members.csv"),
    });
    expect(response.status).toBe(409);
  });
});
