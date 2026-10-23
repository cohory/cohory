import { ForbiddenError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import {
  CourseNotFoundError,
  CoursesValidationError,
  type CourseDetail,
  type LessonDetail,
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

const at = new Date("2026-10-01T10:00:00.000Z");
const courseId = newId();
const moduleId = newId();
const lessonId = newId();

const detail: CourseDetail = {
  id: courseId,
  slug: "clay",
  title: "Clay",
  description: null,
  coverKey: null,
  status: "published",
  position: 1024,
  lessonCount: 1,
  publishedLessonCount: 1,
  completedLessonCount: 0,
  progressPercent: 0,
  requiredLevel: null,
  locked: false,
  createdAt: at,
  updatedAt: at,
  modules: [
    {
      id: moduleId,
      courseId,
      title: "Basics",
      position: 1024,
      lessons: [
        {
          id: lessonId,
          moduleId,
          slug: "welcome",
          title: "Welcome",
          status: "published",
          position: 1024,
          hasVideo: false,
          completed: false,
        },
      ],
    },
  ],
};

const lesson: LessonDetail = {
  id: lessonId,
  courseId,
  moduleId,
  slug: "welcome",
  title: "Welcome",
  status: "published",
  position: 1024,
  bodyMarkdown: "# Hi",
  videoUrl: null,
  attachments: [],
  createdAt: at,
  updatedAt: at,
  bodyHtml: "<h1>Hi</h1>\n",
  videoProvider: null,
  course: { id: courseId, slug: "clay", title: "Clay" },
  previousLesson: null,
  nextLesson: null,
  completedAt: at,
};

let stub: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let member: string;

beforeEach(() => {
  const communitiesRepo = createFakeRepository();
  const community = communitiesRepo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  });
  communityId = community.id;
  member = newId();
  communitiesRepo.addMembership({
    communityId: community.id,
    userId: member,
    role: "member",
    status: "active",
  });
  stub = createStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(communitiesRepo),
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

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown; form?: FormData } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

async function error(response: Response): Promise<{ code: string; details?: unknown }> {
  return ((await response.json()) as { error: { code: string; details?: unknown } }).error;
}

describe("course routes", () => {
  it("lists courses with ISO dates for the resolved community", async () => {
    stub.listCourses.mockResolvedValue([detail]);

    const response = await call("/courses", { userId: member });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { createdAt: string; slug: string }[] };
    expect(body.data[0]).toMatchObject({ slug: "clay", createdAt: at.toISOString() });
    expect(stub.listCourses.mock.calls[0]?.[1]).toBe(communityId);
  });

  it("creates a course with 201 and maps policy denials to 403", async () => {
    stub.createCourse.mockResolvedValueOnce(detail);
    stub.createCourse.mockRejectedValueOnce(new ForbiddenError("create", "course"));

    const created = await call("/courses", {
      method: "POST",
      userId: member,
      body: { title: "Clay" },
    });
    const denied = await call("/courses", { method: "POST", userId: member, body: { title: "x" } });

    expect(created.status).toBe(201);
    expect(stub.createCourse.mock.calls[0]?.[2]).toEqual({ title: "Clay" });
    expect(denied.status).toBe(403);
    expect((await error(denied)).code).toBe("forbidden");
  });

  it("answers 404 for hidden courses and 422 for invalid input", async () => {
    stub.getCourse.mockRejectedValue(new CourseNotFoundError("course"));
    stub.updateCourse.mockRejectedValue(
      new CoursesValidationError([{ path: "coverKey", message: "Upload it first." }]),
    );

    const hidden = await call("/courses/secret", { userId: member });
    const invalid = await call("/courses/clay", {
      method: "PATCH",
      userId: member,
      body: { coverKey: "x" },
    });
    const badBody = await call("/courses", { method: "POST", userId: member, body: { title: 4 } });

    expect(hidden.status).toBe(404);
    expect((await error(hidden)).code).toBe("not_found");
    expect(invalid.status).toBe(422);
    expect(await error(invalid)).toMatchObject({
      code: "validation_failed",
      details: [{ path: "coverKey", message: "Upload it first." }],
    });
    expect(badBody.status).toBe(422);
    expect(stub.createCourse).not.toHaveBeenCalled();
  });

  it("passes the required level to the course update and rejects levels outside 1 to 9", async () => {
    stub.updateCourse.mockResolvedValue({ ...detail, requiredLevel: 3 });

    const updated = await call("/courses/clay", {
      method: "PATCH",
      userId: member,
      body: { requiredLevel: 3 },
    });
    const tooHigh = await call("/courses/clay", {
      method: "PATCH",
      userId: member,
      body: { requiredLevel: 10 },
    });

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ requiredLevel: 3, locked: false });
    expect(stub.updateCourse.mock.calls[0]?.[3]).toEqual({ requiredLevel: 3 });
    expect(tooHigh.status).toBe(422);
    expect(stub.updateCourse).toHaveBeenCalledTimes(1);
  });

  it("maps a community the caller cannot see to 404", async () => {
    stub.listCourses.mockRejectedValue(new CourseNotFoundError("community"));

    const response = await call("/courses", { userId: newId() });

    expect(response.status).toBe(404);
    expect((await error(response)).code).toBe("not_found");
  });

  it("returns 404 for an unknown community slug without calling the service", async () => {
    const response = await api.request("/api/v1/communities/nowhere/courses", {
      headers: { [sessionHeader]: member },
    });

    expect(response.status).toBe(404);
    expect(stub.listCourses).not.toHaveBeenCalled();
  });

  it("publishes, unpublishes, and deletes by course slug", async () => {
    stub.publishCourse.mockResolvedValue(detail);
    stub.unpublishCourse.mockResolvedValue({ ...detail, status: "draft" });
    stub.deleteCourse.mockResolvedValue({ outcome: "archived" });

    expect((await call("/courses/clay/publish", { method: "POST", userId: member })).status).toBe(
      200,
    );
    expect(
      await (await call("/courses/clay/unpublish", { method: "POST", userId: member })).json(),
    ).toMatchObject({ status: "draft" });
    expect(
      await (await call("/courses/clay", { method: "DELETE", userId: member })).json(),
    ).toEqual({
      outcome: "archived",
    });
  });
});

describe("module and lesson routes", () => {
  it("passes reorder lists through and rejects ids that are not uuids", async () => {
    stub.reorderModules.mockResolvedValue(detail);
    stub.reorderLessons.mockResolvedValue(detail);

    const modules = await call("/courses/clay/modules/reorder", {
      method: "POST",
      userId: member,
      body: { ids: [moduleId] },
    });
    const lessons = await call(`/courses/clay/modules/${moduleId}/lessons/reorder`, {
      method: "POST",
      userId: member,
      body: { ids: [lessonId] },
    });
    const bad = await call("/courses/clay/modules/reorder", {
      method: "POST",
      userId: member,
      body: { ids: ["nope"] },
    });

    expect(modules.status).toBe(200);
    expect(stub.reorderModules.mock.calls[0]?.slice(2)).toEqual(["clay", { ids: [moduleId] }]);
    expect(lessons.status).toBe(200);
    expect(stub.reorderLessons.mock.calls[0]?.slice(2)).toEqual([
      "clay",
      moduleId,
      { ids: [lessonId] },
    ]);
    expect(bad.status).toBe(422);
  });

  it("creates, renames, and deletes modules and lessons", async () => {
    stub.createModule.mockResolvedValue(detail.modules[0] ?? never());
    stub.updateModule.mockResolvedValue(detail.modules[0] ?? never());
    stub.deleteModule.mockResolvedValue(undefined);
    stub.createLesson.mockResolvedValue(lesson);
    stub.updateLesson.mockResolvedValue(lesson);
    stub.deleteLesson.mockResolvedValue(undefined);
    stub.publishLesson.mockResolvedValue(lesson);
    stub.unpublishLesson.mockResolvedValue({ ...lesson, status: "draft" });

    const statuses = [
      (
        await call("/courses/clay/modules", {
          method: "POST",
          userId: member,
          body: { title: "M" },
        })
      ).status,
      (
        await call(`/courses/clay/modules/${moduleId}`, {
          method: "PATCH",
          userId: member,
          body: { title: "N" },
        })
      ).status,
      (await call(`/courses/clay/modules/${moduleId}`, { method: "DELETE", userId: member }))
        .status,
      (
        await call(`/courses/clay/modules/${moduleId}/lessons`, {
          method: "POST",
          userId: member,
          body: { title: "L" },
        })
      ).status,
      (await call(`/lessons/${lessonId}`, { method: "PATCH", userId: member, body: { moduleId } }))
        .status,
      (await call(`/lessons/${lessonId}/publish`, { method: "POST", userId: member })).status,
      (await call(`/lessons/${lessonId}/unpublish`, { method: "POST", userId: member })).status,
      (await call(`/lessons/${lessonId}`, { method: "DELETE", userId: member })).status,
    ];

    expect(statuses).toEqual([201, 200, 204, 201, 200, 200, 200, 204]);
    expect(stub.updateLesson.mock.calls[0]?.slice(2)).toEqual([lessonId, { moduleId }]);
  });

  it("serves a lesson with html, neighbours, and completion", async () => {
    stub.getLesson.mockResolvedValue(lesson);

    const response = await call("/courses/clay/lessons/welcome", { userId: member });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bodyHtml: "<h1>Hi</h1>\n",
      completedAt: at.toISOString(),
      previousLesson: null,
    });
    expect(stub.getLesson.mock.calls[0]?.slice(2)).toEqual(["clay", "welcome"]);
  });

  it("marks completion, records views, and returns continue learning", async () => {
    const progress = {
      courseId,
      lessonId,
      completed: true,
      completedLessonCount: 1,
      publishedLessonCount: 1,
      progressPercent: 100,
    };
    stub.markLessonComplete.mockResolvedValue(progress);
    stub.markLessonIncomplete.mockResolvedValue({
      ...progress,
      completed: false,
      progressPercent: 0,
    });
    stub.recordLessonView.mockResolvedValue(undefined);
    stub.getContinueLearning.mockResolvedValue(null);

    const done = await call(`/lessons/${lessonId}/complete`, { method: "POST", userId: member });
    const undone = await call(`/lessons/${lessonId}/complete`, {
      method: "DELETE",
      userId: member,
    });
    const viewed = await call(`/lessons/${lessonId}/view`, { method: "POST", userId: member });
    const next = await call("/continue-learning", { userId: member });

    expect(await done.json()).toMatchObject({ progressPercent: 100 });
    expect(await undone.json()).toMatchObject({ completed: false });
    expect(viewed.status).toBe(204);
    expect(await next.json()).toEqual({ data: null });
  });
});

describe("attachment upload", () => {
  it("passes the multipart file to the service and returns the reference", async () => {
    const ref = {
      key: "communities/x/courses/y/attachments/z.pdf",
      name: "a.pdf",
      size: 9,
      contentType: "application/pdf",
    };
    stub.uploadLessonAttachment.mockResolvedValue(ref);
    const form = new FormData();
    form.set(
      "file",
      new File([new TextEncoder().encode("%PDF-1.7\n")], "a.pdf", { type: "application/pdf" }),
    );

    const response = await call(`/courses/${courseId}/uploads/attachment`, {
      method: "POST",
      userId: member,
      form,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(ref);
    const [, id, course, upload] = stub.uploadLessonAttachment.mock.calls[0] ?? [];
    expect([id, course]).toEqual([communityId, courseId]);
    expect(upload).toMatchObject({ name: "a.pdf", declaredType: "application/pdf" });
    expect(upload?.bytes.byteLength).toBe(9);
  });

  it("rejects a request without a file", async () => {
    const response = await call(`/courses/${courseId}/uploads/attachment`, {
      method: "POST",
      userId: member,
      form: new FormData(),
    });

    expect(response.status).toBe(422);
    expect(stub.uploadLessonAttachment).not.toHaveBeenCalled();
  });

  it("refuses json bodies over 512 KB on course routes", async () => {
    const response = await call("/courses", {
      method: "POST",
      userId: member,
      body: { title: "x".repeat(600 * 1024) },
    });

    expect(response.status).toBe(413);
    expect((await error(response)).code).toBe("payload_too_large");
  });
});

describe("course openapi", () => {
  it("documents every course operation", () => {
    const document = createOpenApiDocument(api);
    const operations = Object.values(document.paths ?? {}).flatMap((item) =>
      Object.values(item ?? {}).map((op) => (op as { operationId?: string }).operationId),
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        "listCourses",
        "createCourse",
        "getCourse",
        "updateCourse",
        "deleteCourse",
        "publishCourse",
        "unpublishCourse",
        "createCourseModule",
        "updateCourseModule",
        "deleteCourseModule",
        "reorderCourseModules",
        "createLesson",
        "reorderLessons",
        "getLesson",
        "updateLesson",
        "deleteLesson",
        "publishLesson",
        "unpublishLesson",
        "completeLesson",
        "uncompleteLesson",
        "recordLessonView",
        "getContinueLearning",
        "uploadLessonAttachment",
      ]),
    );
  });
});

function never(): never {
  throw new Error("fixture missing");
}
