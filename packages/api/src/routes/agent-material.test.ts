import { ApprovalRequiredError, ForbiddenError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import {
  CourseNotFoundError,
  CoursesValidationError,
  type AgentMaterial,
  type AgentVersionSummary,
} from "@cohory/courses";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import type { SessionResolver } from "../middleware/session";
import { createStub, type Stub } from "../test/courses-stub";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const courseId = newId();
const lessonId = newId();
const at = new Date("2026-10-19T10:00:00.000Z");
const version: AgentVersionSummary = {
  id: newId(),
  courseId,
  version: "1.0.0",
  changelog: "First.",
  checksum: "a".repeat(64),
  publishedAt: at,
};
const material: AgentMaterial = {
  notice: "data",
  checksum: "a".repeat(64),
  manifest: {
    format: "cohory-agent-course",
    formatVersion: "1.0.0",
    course: { id: courseId, slug: "clay", title: "Clay", description: "" },
    version: "1.0.0",
    changelog: "First.",
    publishedAt: at.toISOString(),
    license: { id: "personal-agent-use", text: "" },
    sourceUrl: "https://cohory.example/c/makers/classroom/clay",
    contentSha256: "b".repeat(64),
  },
  lessons: [],
};

let stub: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let member: string;

beforeEach(() => {
  const repo = createFakeRepository();
  const community = repo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  });
  communityId = community.id;
  member = newId();
  repo.addMembership({ communityId, userId: member, role: "member", status: "active" });
  stub = createStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      courses: stub,
    }),
  );
});

function call(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData; userId?: string } = {},
) {
  const headers = new Headers();
  headers.set(sessionHeader, init.userId ?? member);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

describe("agent material routes", () => {
  it("reads the published material for a course id, optionally by version", async () => {
    stub.getAgentMaterial.mockResolvedValue(material);
    const latest = await call(`/courses/${courseId}/agent-material`);
    const pinned = await call(`/courses/${courseId}/agent-material?version=1.0.0`);
    expect(latest.status).toBe(200);
    expect(((await latest.json()) as AgentMaterial).manifest.version).toBe("1.0.0");
    expect(pinned.status).toBe(200);
    expect(stub.getAgentMaterial.mock.calls[0]?.slice(1)).toEqual([
      communityId,
      courseId,
      { version: undefined },
    ]);
    expect(stub.getAgentMaterial.mock.calls[1]?.[3]).toEqual({ version: "1.0.0" });
  });

  it("refuses a malformed version and a missing task", async () => {
    stub.getAgentTask.mockRejectedValue(new CourseNotFoundError("agent_task"));
    expect((await call(`/courses/${courseId}/agent-material?version=../1`)).status).toBe(422);
    expect(
      (await call(`/courses/${courseId}/agent-material/lessons/${lessonId}/tasks/nope`)).status,
    ).toBe(404);
  });

  it("publishes a version with 201, 403 approval_required for agents, and 422 when unchanged", async () => {
    stub.publishAgentVersion.mockResolvedValueOnce(version);
    stub.publishAgentVersion.mockRejectedValueOnce(
      new ApprovalRequiredError("publish_agent_version", "course", "publishing"),
    );
    stub.publishAgentVersion.mockRejectedValueOnce(
      new CoursesValidationError([
        { path: "bump", message: "Nothing changed since version 1.0.0." },
      ]),
    );
    const body = {
      bump: "major",
      changelog: "First.",
      license: { id: "personal-agent-use", text: "" },
    };
    const created = await call("/courses/clay/agent-versions", { method: "POST", body });
    const approval = await call("/courses/clay/agent-versions", { method: "POST", body });
    const unchanged = await call("/courses/clay/agent-versions", { method: "POST", body });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { publishedAt: string }).publishedAt).toBe(at.toISOString());
    expect(approval.status).toBe(403);
    expect(((await approval.json()) as { error: { code: string } }).error.code).toBe(
      "approval_required",
    );
    expect(unchanged.status).toBe(422);
    expect(
      (await call("/courses/clay/agent-versions", { method: "POST", body: { bump: "huge" } }))
        .status,
    ).toBe(422);
  });

  it("downloads the skill zip as an attachment", async () => {
    stub.exportAgentVersion.mockResolvedValue({
      fileName: "clay-1.0.0.zip",
      version: "1.0.0",
      checksum: "c".repeat(64),
      bytes: new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    });
    const response = await call("/courses/clay/agent-versions/1.0.0/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="clay-1.0.0.zip"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(4);
  });

  it("serves material files sandboxed as attachments", async () => {
    stub.getAgentMaterialFile.mockResolvedValue({
      name: "page.md",
      mediaType: "text/markdown; charset=utf-8",
      sha256: "d".repeat(64),
      bytes: new TextEncoder().encode("<script>x</script>"),
    });
    const response = await call(
      `/courses/${courseId}/agent-material/files?path=references/001-a/page.md`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(stub.getAgentMaterialFile.mock.calls[0]?.[3]).toBe("references/001-a/page.md");
  });

  it("maps denied authoring to 403 and passes the draft through", async () => {
    stub.saveLessonAgentLayer.mockRejectedValue(new ForbiddenError("update", "course"));
    stub.draftLessonAgentLayer.mockResolvedValue({
      objective: "Do it",
      instructions: "",
      references: [],
      templates: [],
      tasks: [],
      evaluations: [],
    });
    const layer = {
      objective: "x",
      instructions: "",
      references: [],
      templates: [],
      tasks: [],
      evaluations: [],
    };
    expect(
      (await call(`/lessons/${lessonId}/agent-layer`, { method: "PUT", body: layer })).status,
    ).toBe(403);
    const draft = await call(`/lessons/${lessonId}/agent-layer/draft`, { method: "POST" });
    expect(draft.status).toBe(200);
    expect(((await draft.json()) as { objective: string }).objective).toBe("Do it");
  });

  it("accepts agent layers larger than the default JSON limit", async () => {
    stub.saveLessonAgentLayer.mockResolvedValue({
      lesson: { id: lessonId, slug: "a", title: "A", status: "published", courseId },
      layer: null,
      updatedAt: at,
    });
    const big = "x".repeat(600 * 1024);
    const layer = {
      objective: "x",
      instructions: big,
      references: [],
      templates: [],
      tasks: [],
      evaluations: [],
    };
    const response = await call(`/lessons/${lessonId}/agent-layer`, { method: "PUT", body: layer });
    expect(response.status).toBe(422);
  });

  it("documents every agent material route with its scope", () => {
    const document = createOpenApiDocument();
    const operations = Object.entries(document.paths ?? {})
      .filter(([path]) => /agent-(material|layer|versions|file)/.test(path))
      .flatMap(([, item]) => Object.values(item ?? {}))
      .map(
        (operation) => (operation as { "x-cohory"?: { scope: string | null } })["x-cohory"]?.scope,
      );
    expect(operations).toHaveLength(13);
    expect(operations.every((scope) => scope === "courses:read" || scope === "courses:write")).toBe(
      true,
    );
  });
});
