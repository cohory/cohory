import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import { type CoursesService } from "@cohory/courses";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import {
  attachmentSchema,
  attachmentUploadFormSchema,
  continueLearningJson,
  continueLearningSchema,
  courseDetailJson,
  courseDetailSchema,
  courseIdParams,
  courseParams,
  courseProgressSchema,
  courseSummaryJson,
  courseSummarySchema,
  createCourseBodySchema,
  createLessonBodySchema,
  deleteCourseResultSchema,
  lessonDetailJson,
  lessonDetailSchema,
  lessonIdParams,
  lessonJson,
  lessonSchema,
  lessonSlugParams,
  moduleBodySchema,
  moduleJson,
  moduleParams,
  moduleSchema,
  reorderBodySchema,
  updateCourseBodySchema,
  updateLessonBodySchema,
} from "./courses-schemas";
import { registerAgentMaterialRoutes } from "./agent-material";
import { errorResponse, json, slugParams } from "./posts-schemas";

const jsonLimit = bodyLimit({ maxSize: 512 * 1024 });

export interface CoursesRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  courses: CoursesService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Courses"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse(
    "The community, course, module, or lesson does not exist or is not visible to the caller.",
  ),
  422: errorResponse("The input is invalid."),
};
const managers = " Admins and owners only.";

function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const listCourses = createRoute({
  method: "get",
  path: "/communities/{slug}/courses",
  operationId: "listCourses",
  "x-cohory": routeMeta("listCourses"),
  tags,
  security,
  summary: "List courses",
  description:
    "Courses in classroom order with lesson counts and the caller's progress. Members see published courses; admins and owners also see drafts and archived courses.",
  request: { params: slugParams },
  responses: {
    200: json(
      z.object({ data: z.array(courseSummarySchema), ...pageCursor }).openapi("CourseList"),
      "Courses.",
    ),
    ...errors,
  },
});

const createCourse = createRoute({
  method: "post",
  path: "/communities/{slug}/courses",
  operationId: "createCourse",
  "x-cohory": routeMeta("createCourse"),
  tags,
  security,
  summary: "Create a course",
  description: `Creates a draft course. The slug comes from the title, with a numeric suffix when taken.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(createCourseBodySchema) },
  responses: { 201: json(courseDetailSchema, "The new course."), ...errors },
});

const getCourse = createRoute({
  method: "get",
  path: "/communities/{slug}/courses/{courseSlug}",
  operationId: "getCourse",
  "x-cohory": routeMeta("getCourse"),
  tags,
  security,
  summary: "Get a course with its modules and lessons",
  description: "Members see published lessons only, with their own completion per lesson.",
  request: { params: courseParams },
  responses: { 200: json(courseDetailSchema, "The course outline."), ...errors },
});

const updateCourse = createRoute({
  method: "patch",
  path: "/communities/{slug}/courses/{courseSlug}",
  operationId: "updateCourse",
  "x-cohory": routeMeta("updateCourse"),
  tags,
  security,
  summary: "Update a course",
  description: `Changes the title, description, cover, or the level that unlocks the course. The slug stays the same.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: courseParams, ...jsonBody(updateCourseBodySchema) },
  responses: { 200: json(courseDetailSchema, "The updated course."), ...errors },
});

const deleteCourse = createRoute({
  method: "delete",
  path: "/communities/{slug}/courses/{courseSlug}",
  operationId: "deleteCourse",
  "x-cohory": routeMeta("deleteCourse"),
  tags,
  security,
  summary: "Delete a course",
  description: `Deletes a course nobody has started. A course with member progress is archived instead.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: courseParams },
  responses: { 200: json(deleteCourseResultSchema, "What happened to the course."), ...errors },
});

function courseStatusRoute(action: "publish" | "unpublish") {
  return createRoute({
    method: "post",
    path: `/communities/{slug}/courses/{courseSlug}/${action}`,
    operationId: `${action}Course`,
    "x-cohory": routeMeta(`${action}Course`),
    tags,
    security,
    summary: action === "publish" ? "Publish a course" : "Move a course back to draft",
    description: `${action === "publish" ? "Shows the course to members. Answers 422 when no lesson is published, because members would see an empty course." : "Hides the course from members."}${managers}`,
    middleware: [jsonLimit] as const,
    request: { params: courseParams },
    responses: {
      200: json(courseDetailSchema, "The course."),
      ...errors,
      422: errorResponse(
        action === "publish"
          ? "The input is invalid, or no lesson in the course is published."
          : "The input is invalid.",
      ),
    },
  });
}

const publishCourse = courseStatusRoute("publish");
const unpublishCourse = courseStatusRoute("unpublish");

const createModule = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseSlug}/modules",
  operationId: "createCourseModule",
  "x-cohory": routeMeta("createCourseModule"),
  tags,
  security,
  summary: "Add a module",
  description: `Adds a module at the end of the course.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: courseParams, ...jsonBody(moduleBodySchema) },
  responses: { 201: json(moduleSchema, "The new module."), ...errors },
});

const updateModule = createRoute({
  method: "patch",
  path: "/communities/{slug}/courses/{courseSlug}/modules/{moduleId}",
  operationId: "updateCourseModule",
  "x-cohory": routeMeta("updateCourseModule"),
  tags,
  security,
  summary: "Rename a module",
  description: managers.trim(),
  middleware: [jsonLimit] as const,
  request: { params: moduleParams, ...jsonBody(moduleBodySchema) },
  responses: { 200: json(moduleSchema, "The module."), ...errors },
});

const deleteModule = createRoute({
  method: "delete",
  path: "/communities/{slug}/courses/{courseSlug}/modules/{moduleId}",
  operationId: "deleteCourseModule",
  "x-cohory": routeMeta("deleteCourseModule"),
  tags,
  security,
  summary: "Delete a module and its lessons",
  description: managers.trim(),
  middleware: [jsonLimit] as const,
  request: { params: moduleParams },
  responses: { 204: { description: "The module is deleted." }, ...errors },
});

const reorderModules = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseSlug}/modules/reorder",
  operationId: "reorderCourseModules",
  "x-cohory": routeMeta("reorderCourseModules"),
  tags,
  security,
  summary: "Reorder modules",
  description: `Takes every module id of the course in the new order.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: courseParams, ...jsonBody(reorderBodySchema) },
  responses: { 200: json(courseDetailSchema, "The course in its new order."), ...errors },
});

const createLesson = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseSlug}/modules/{moduleId}/lessons",
  operationId: "createLesson",
  "x-cohory": routeMeta("createLesson"),
  tags,
  security,
  summary: "Add a lesson",
  description: `Adds a draft lesson at the end of the module.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: moduleParams, ...jsonBody(createLessonBodySchema) },
  responses: { 201: json(lessonSchema, "The new lesson."), ...errors },
});

const reorderLessons = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseSlug}/modules/{moduleId}/lessons/reorder",
  operationId: "reorderLessons",
  "x-cohory": routeMeta("reorderLessons"),
  tags,
  security,
  summary: "Reorder lessons in a module",
  description: `Takes every lesson id of the module in the new order. Move a lesson to another module with the lesson update endpoint.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: moduleParams, ...jsonBody(reorderBodySchema) },
  responses: { 200: json(courseDetailSchema, "The course in its new order."), ...errors },
});

const getLesson = createRoute({
  method: "get",
  path: "/communities/{slug}/courses/{courseSlug}/lessons/{lessonSlug}",
  operationId: "getLesson",
  "x-cohory": routeMeta("getLesson"),
  tags,
  security,
  summary: "Get a lesson",
  description:
    "The lesson with sanitized HTML, the previous and next lesson in course order, and the caller's completion. Members see published lessons only.",
  request: { params: lessonSlugParams },
  responses: { 200: json(lessonDetailSchema, "The lesson."), ...errors },
});

const updateLesson = createRoute({
  method: "patch",
  path: "/communities/{slug}/lessons/{lessonId}",
  operationId: "updateLesson",
  "x-cohory": routeMeta("updateLesson"),
  tags,
  security,
  summary: "Update a lesson",
  description: `Changes the title, markdown body, video link, attachments, or module. The slug stays the same.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: lessonIdParams, ...jsonBody(updateLessonBodySchema) },
  responses: { 200: json(lessonSchema, "The lesson."), ...errors },
});

const deleteLesson = createRoute({
  method: "delete",
  path: "/communities/{slug}/lessons/{lessonId}",
  operationId: "deleteLesson",
  "x-cohory": routeMeta("deleteLesson"),
  tags,
  security,
  summary: "Delete a lesson",
  description: managers.trim(),
  middleware: [jsonLimit] as const,
  request: { params: lessonIdParams },
  responses: { 204: { description: "The lesson is deleted." }, ...errors },
});

function lessonStatusRoute(action: "publish" | "unpublish") {
  return createRoute({
    method: "post",
    path: `/communities/{slug}/lessons/{lessonId}/${action}`,
    operationId: `${action}Lesson`,
    "x-cohory": routeMeta(`${action}Lesson`),
    tags,
    security,
    summary: action === "publish" ? "Publish a lesson" : "Move a lesson back to draft",
    description: managers.trim(),
    middleware: [jsonLimit] as const,
    request: { params: lessonIdParams },
    responses: { 200: json(lessonSchema, "The lesson."), ...errors },
  });
}

const publishLesson = lessonStatusRoute("publish");
const unpublishLesson = lessonStatusRoute("unpublish");

function completionRoute(method: "post" | "delete") {
  return createRoute({
    method,
    path: "/communities/{slug}/lessons/{lessonId}/complete",
    operationId: method === "post" ? "completeLesson" : "uncompleteLesson",
    "x-cohory": routeMeta(method === "post" ? "completeLesson" : "uncompleteLesson"),
    tags,
    security,
    summary: method === "post" ? "Mark a lesson complete" : "Mark a lesson not complete",
    description: "Updates the caller's own progress and returns the course progress.",
    request: { params: lessonIdParams },
    responses: { 200: json(courseProgressSchema, "The caller's course progress."), ...errors },
  });
}

const completeLesson = completionRoute("post");
const uncompleteLesson = completionRoute("delete");

const viewLesson = createRoute({
  method: "post",
  path: "/communities/{slug}/lessons/{lessonId}/view",
  operationId: "recordLessonView",
  "x-cohory": routeMeta("recordLessonView"),
  tags,
  security,
  summary: "Record that the caller opened a lesson",
  description: "Feeds the continue learning card.",
  middleware: [jsonLimit] as const,
  request: { params: lessonIdParams },
  responses: { 204: { description: "Recorded." }, ...errors },
});

const continueLearning = createRoute({
  method: "get",
  path: "/communities/{slug}/continue-learning",
  operationId: "getContinueLearning",
  "x-cohory": routeMeta("getContinueLearning"),
  tags,
  security,
  summary: "Get the lesson to continue with",
  description:
    "The caller's most recently viewed incomplete lesson in a published course, or the next incomplete lesson of that course. Null when there is nothing to continue.",
  request: { params: slugParams },
  responses: { 200: json(continueLearningSchema, "The lesson or null."), ...errors },
});

const uploadAttachment = createRoute({
  method: "post",
  path: "/communities/{slug}/courses/{courseId}/uploads/attachment",
  operationId: "uploadLessonAttachment",
  "x-cohory": routeMeta("uploadLessonAttachment"),
  tags,
  security,
  summary: "Upload a lesson attachment",
  description: `Accepts one PDF, ZIP, PNG, JPEG, Markdown, text, or CSV file up to 25 MB in the \`file\` field. Returns the reference to add to a lesson's attachments.${managers}`,
  middleware: [bodyLimit({ maxSize: 25 * 1024 * 1024 + 64 * 1024 })] as const,
  request: {
    params: courseIdParams,
    body: {
      required: true,
      content: { "multipart/form-data": { schema: attachmentUploadFormSchema } },
    },
  },
  responses: { 201: json(attachmentSchema, "The stored file."), ...errors },
});

export function createCoursesRoutes(getDeps: () => CoursesRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/courses", actor);
  app.use("/communities/:slug/courses/*", actor);
  app.use("/communities/:slug/lessons/*", actor);
  app.use("/communities/:slug/continue-learning", actor);

  const courses = () => getDeps().courses;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  const routes = app
    .openapi(listCourses, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const list = await courses().listCourses(caller, id);
      return c.json({ data: list.map(courseSummaryJson), nextCursor: null }, 200);
    })
    .openapi(createCourse, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const course = await courses().createCourse(caller, id, c.req.valid("json"));
      return c.json(courseDetailJson(course), 201);
    })
    .openapi(getCourse, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const course = await courses().getCourse(caller, await communityId(caller, slug), courseSlug);
      return c.json(courseDetailJson(course), 200);
    })
    .openapi(updateCourse, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const course = await courses().updateCourse(caller, id, courseSlug, c.req.valid("json"));
      return c.json(courseDetailJson(course), 200);
    })
    .openapi(deleteCourse, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await courses().deleteCourse(caller, id, courseSlug), 200);
    })
    .openapi(publishCourse, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(courseDetailJson(await courses().publishCourse(caller, id, courseSlug)), 200);
    })
    .openapi(unpublishCourse, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(courseDetailJson(await courses().unpublishCourse(caller, id, courseSlug)), 200);
    })
    .openapi(reorderModules, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const course = await courses().reorderModules(caller, id, courseSlug, c.req.valid("json"));
      return c.json(courseDetailJson(course), 200);
    })
    .openapi(createModule, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const module = await courses().createModule(caller, id, courseSlug, c.req.valid("json"));
      return c.json(moduleJson(module), 201);
    })
    .openapi(updateModule, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug, moduleId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const module = await courses().updateModule(
        caller,
        id,
        courseSlug,
        moduleId,
        c.req.valid("json"),
      );
      return c.json(moduleJson(module), 200);
    })
    .openapi(deleteModule, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug, moduleId } = c.req.valid("param");
      await courses().deleteModule(caller, await communityId(caller, slug), courseSlug, moduleId);
      return c.body(null, 204);
    })
    .openapi(reorderLessons, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug, moduleId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const course = await courses().reorderLessons(
        caller,
        id,
        courseSlug,
        moduleId,
        c.req.valid("json"),
      );
      return c.json(courseDetailJson(course), 200);
    })
    .openapi(createLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug, moduleId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const lesson = await courses().createLesson(
        caller,
        id,
        courseSlug,
        moduleId,
        c.req.valid("json"),
      );
      return c.json(lessonJson(lesson), 201);
    })
    .openapi(getLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, courseSlug, lessonSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const lesson = await courses().getLesson(caller, id, courseSlug, lessonSlug);
      return c.json(lessonDetailJson(lesson), 200);
    })
    .openapi(updateLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const lesson = await courses().updateLesson(caller, id, lessonId, c.req.valid("json"));
      return c.json(lessonJson(lesson), 200);
    })
    .openapi(deleteLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      await courses().deleteLesson(caller, await communityId(caller, slug), lessonId);
      return c.body(null, 204);
    })
    .openapi(publishLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(lessonJson(await courses().publishLesson(caller, id, lessonId)), 200);
    })
    .openapi(unpublishLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(lessonJson(await courses().unpublishLesson(caller, id, lessonId)), 200);
    })
    .openapi(completeLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await courses().markLessonComplete(caller, id, lessonId), 200);
    })
    .openapi(uncompleteLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await courses().markLessonIncomplete(caller, id, lessonId), 200);
    })
    .openapi(viewLesson, async (c) => {
      const caller = c.get("actor");
      const { slug, lessonId } = c.req.valid("param");
      await courses().recordLessonView(caller, await communityId(caller, slug), lessonId);
      return c.body(null, 204);
    })
    .openapi(continueLearning, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(continueLearningJson(await courses().getContinueLearning(caller, id)), 200);
    })
    .openapi(uploadAttachment, async (c) => {
      const caller = c.get("actor");
      const { slug, courseId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const { file } = c.req.valid("form");
      const ref = await courses().uploadLessonAttachment(caller, id, courseId, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        declaredType: file.type,
      });
      return c.json(ref, 201);
    });

  return registerAgentMaterialRoutes(routes, courses, communityId);
}
