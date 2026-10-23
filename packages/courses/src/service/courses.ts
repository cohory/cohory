import { assertCan, type Actor } from "@cohory/authz";

import { CoursesValidationError } from "../errors";
import { appendPosition, planReorder } from "../positions";
import {
  createCourseInputSchema,
  moduleInputSchema,
  reorderInputSchema,
  updateCourseInputSchema,
  type CreateCourseInput,
  type ModuleInput,
  type ReorderInput,
  type UpdateCourseInput,
} from "../schemas";
import type {
  CourseDetail,
  CoursePreview,
  CourseSummary,
  DeleteCourseResult,
  ModuleView,
} from "../views";
import { parse, withAccess, withCommunityRead, withWriteAccess, type Runtime } from "./context";
import {
  checkCoverKey,
  courseDetail,
  insertWithSlug,
  lockOf,
  requireCourse,
  requireModule,
  toSummary,
} from "./outline";

export interface PublishCourseOptions {
  readonly publishDraftLessons?: boolean;
}

export interface CourseOperations {
  listCourses(actor: Actor, communityId: string): Promise<CourseSummary[]>;
  countPublishedCourses(actor: Actor, communityId: string): Promise<number>;
  listCoursePreviews(actor: Actor, communityId: string): Promise<CoursePreview[]>;
  getCourse(actor: Actor, communityId: string, courseSlug: string): Promise<CourseDetail>;
  createCourse(actor: Actor, communityId: string, input: CreateCourseInput): Promise<CourseDetail>;
  updateCourse(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    input: UpdateCourseInput,
  ): Promise<CourseDetail>;
  publishCourse(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    options?: PublishCourseOptions,
  ): Promise<CourseDetail>;
  unpublishCourse(actor: Actor, communityId: string, courseSlug: string): Promise<CourseDetail>;
  deleteCourse(actor: Actor, communityId: string, courseSlug: string): Promise<DeleteCourseResult>;
  createModule(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    input: ModuleInput,
  ): Promise<ModuleView>;
  updateModule(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    moduleId: string,
    input: ModuleInput,
  ): Promise<ModuleView>;
  deleteModule(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    moduleId: string,
  ): Promise<void>;
  reorderModules(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    input: ReorderInput,
  ): Promise<CourseDetail>;
}

function moduleOf(detail: CourseDetail, moduleId: string): ModuleView {
  const module = detail.modules.find((candidate) => candidate.id === moduleId);
  if (!module) {
    throw new Error("module missing from its course outline");
  }
  return module;
}

export function createCourseOperations(runtime: Runtime): CourseOperations {
  return {
    listCourses(actor, communityId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const { store, visibility, viewerId, agentCourseIds } = access;
        const courses = (await store.listCourses(visibility)).filter(
          (course) => agentCourseIds === null || agentCourseIds.has(course.id),
        );
        const stats = new Map(
          (await store.courseStats(visibility, viewerId)).map((row) => [row.courseId, row]),
        );
        return Promise.all(
          courses.map(async (course) =>
            toSummary(course, stats.get(course.id), await lockOf(access, course)),
          ),
        );
      });
    },

    countPublishedCourses(actor, communityId) {
      return withCommunityRead(
        runtime,
        actor,
        communityId,
        async (store) => (await store.listCourses("published")).length,
      );
    },

    listCoursePreviews(actor, communityId) {
      return withCommunityRead(runtime, actor, communityId, async (store) => {
        const [published, stats] = await Promise.all([
          store.listCourses("published"),
          store.courseStats("published", null),
        ]);
        const lessons = new Map(stats.map((row) => [row.courseId, row.publishedLessonCount]));
        return published.map((course) => ({
          title: course.title,
          coverKey: course.coverKey,
          lessonCount: lessons.get(course.id) ?? 0,
        }));
      });
    },

    getCourse(actor, communityId, courseSlug) {
      return withAccess(runtime, actor, communityId, async (access) =>
        courseDetail(access, await requireCourse(access, courseSlug, { allowLocked: true })),
      );
    },

    createCourse(actor, communityId, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "course", access.context);
        const { title, description, coverKey, requiredLevel } = parse(
          createCourseInputSchema,
          input,
        );
        checkCoverKey(access.community.id, coverKey);
        const position = appendPosition(await access.store.lastCoursePosition());
        const course = await insertWithSlug(
          title,
          "course",
          (root) => access.store.courseSlugsLike(root),
          (slug) =>
            access.store.insertCourse({
              slug,
              title,
              description: description ?? null,
              coverKey: coverKey ?? null,
              requiredLevel: requiredLevel ?? null,
              position,
            }),
        );
        return courseDetail(access, course);
      });
    },

    updateCourse(actor, communityId, courseSlug, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "course", access.context);
        const patch = parse(updateCourseInputSchema, input);
        checkCoverKey(access.community.id, patch.coverKey);
        const course = await requireCourse(access, courseSlug);
        return courseDetail(access, await access.store.updateCourse(course.id, patch));
      });
    },

    publishCourse(actor, communityId, courseSlug, options = {}) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "publish", "course", access.context);
        if (options.publishDraftLessons) {
          assertCan(actor, "publish", "lesson", access.context);
        }
        const course = await requireCourse(access, courseSlug);
        const lessons = await access.store.listLessons(course.id, "all");
        const drafts = lessons.filter((lesson) => lesson.status === "draft");
        const visible = options.publishDraftLessons
          ? lessons.length
          : lessons.length - drafts.length;
        if (visible === 0) {
          throw new CoursesValidationError([
            { path: "lessons", message: "Publish at least one lesson before the course." },
          ]);
        }
        if (options.publishDraftLessons) {
          for (const lesson of drafts) {
            await access.store.updateLesson(lesson.id, { status: "published" });
          }
        }
        const published = await access.store.updateCourse(course.id, { status: "published" });
        if (course.status !== "published") {
          await access.store.appendCourseEvents([
            {
              type: "course.published",
              payload: {
                communityId: access.community.id,
                courseId: course.id,
                occurredAt: runtime.now().toISOString(),
              },
            },
          ]);
        }
        return courseDetail(access, published);
      });
    },

    unpublishCourse(actor, communityId, courseSlug) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "publish", "course", access.context);
        const course = await requireCourse(access, courseSlug);
        return courseDetail(
          access,
          await access.store.updateCourse(course.id, { status: "draft" }),
        );
      });
    },

    deleteCourse(actor, communityId, courseSlug) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "delete", "course", access.context);
        const course = await requireCourse(access, courseSlug);
        if (await access.store.courseHasProgress(course.id)) {
          await access.store.updateCourse(course.id, { status: "archived" });
          return { outcome: "archived" };
        }
        await access.store.deleteCourse(course.id);
        return { outcome: "deleted" };
      });
    },

    createModule(actor, communityId, courseSlug, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "course", access.context);
        const { title } = parse(moduleInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const position = appendPosition(await access.store.lastModulePosition(course.id));
        const module = await access.store.insertModule({ courseId: course.id, title, position });
        return moduleOf(await courseDetail(access, course), module.id);
      });
    },

    updateModule(actor, communityId, courseSlug, moduleId, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "course", access.context);
        const { title } = parse(moduleInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const module = await requireModule(access, course, moduleId);
        await access.store.updateModule(module.id, title);
        return moduleOf(await courseDetail(access, course), module.id);
      });
    },

    deleteModule(actor, communityId, courseSlug, moduleId) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "course", access.context);
        const course = await requireCourse(access, courseSlug);
        const module = await requireModule(access, course, moduleId);
        await access.store.deleteModule(module.id);
      });
    },

    reorderModules(actor, communityId, courseSlug, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "reorder", "course", access.context);
        const { ids } = parse(reorderInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const modules = await access.store.listModules(course.id);
        await access.store.setModulePositions(planReorder(modules, ids));
        return courseDetail(access, course);
      });
    },
  };
}
