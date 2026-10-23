import { assertCan, type Actor } from "@cohory/authz";
import {
  courseAttachmentKey,
  isCourseAttachmentKey,
  validateAttachment,
  type AttachmentUpload,
} from "@cohory/storage";

import { z } from "zod";

import { CourseNotFoundError } from "../errors";
import { appendPosition, planReorder } from "../positions";
import type { CourseRecord, LessonPatch, LessonRecord } from "../repository";
import {
  createLessonInputSchema,
  maxTitleLength,
  reorderInputSchema,
  updateLessonInputSchema,
  type CreateLessonInput,
  type ReorderInput,
  type UpdateLessonInput,
} from "../schemas";
import { maxSlugLength, nextFreeSlug, slugify } from "../slug";
import type { AttachmentRef, CourseDetail, LessonView } from "../views";
import { isUuid, parse, withAccess, withWriteAccess, type Access, type Runtime } from "./context";
import {
  checkAttachments,
  courseDetail,
  insertWithSlug,
  requireCourse,
  requireModule,
  toLessonView,
} from "./outline";

const moveLessonInputSchema = z.strictObject({
  moduleId: z.uuid(),
  position: z.int().min(0).optional(),
});

export type MoveLessonInput = z.input<typeof moveLessonInputSchema>;

export interface LessonOperations {
  createLesson(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    moduleId: string,
    input: CreateLessonInput,
  ): Promise<LessonView>;
  updateLesson(
    actor: Actor,
    communityId: string,
    lessonId: string,
    input: UpdateLessonInput,
  ): Promise<LessonView>;
  publishLesson(actor: Actor, communityId: string, lessonId: string): Promise<LessonView>;
  unpublishLesson(actor: Actor, communityId: string, lessonId: string): Promise<LessonView>;
  deleteLesson(actor: Actor, communityId: string, lessonId: string): Promise<void>;
  moveLesson(
    actor: Actor,
    communityId: string,
    lessonId: string,
    input: MoveLessonInput,
  ): Promise<CourseDetail>;
  duplicateLesson(actor: Actor, communityId: string, lessonId: string): Promise<LessonView>;
  reorderLessons(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    moduleId: string,
    input: ReorderInput,
  ): Promise<CourseDetail>;
  uploadLessonAttachment(
    actor: Actor,
    communityId: string,
    courseId: string,
    upload: AttachmentUpload,
  ): Promise<AttachmentRef>;
  getLessonAttachment(actor: Actor, communityId: string, key: string): Promise<AttachmentRef>;
}

const copySuffix = " (copy)";

function copyTitle(title: string): string {
  return `${title.slice(0, maxTitleLength - copySuffix.length).trimEnd()}${copySuffix}`;
}

async function slugForDraft(access: Access, lesson: LessonRecord, title: string): Promise<string> {
  const root = slugify(title) || "lesson";
  if (lesson.slug === root || isSuffixed(lesson.slug, root)) {
    return lesson.slug;
  }
  const taken = await access.store.lessonSlugsLike(lesson.courseId, root);
  return nextFreeSlug(
    root,
    "lesson",
    taken.filter((slug) => slug !== lesson.slug),
  );
}

function isSuffixed(slug: string, root: string): boolean {
  const suffix = /-(\d+)$/.exec(slug)?.[0];
  if (!suffix) {
    return false;
  }
  return slug === `${root.slice(0, maxSlugLength - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

async function requireLesson(
  access: Access,
  lessonId: string,
): Promise<{ course: CourseRecord; lesson: LessonRecord }> {
  const lesson = isUuid(lessonId)
    ? await access.store.findVisibleLesson(lessonId, access.visibility)
    : null;
  const course = lesson
    ? await access.store.findCourseById(lesson.courseId, access.visibility)
    : null;
  if (!lesson || !course) {
    throw new CourseNotFoundError("lesson");
  }
  return { course, lesson };
}

export function createLessonOperations(runtime: Runtime): LessonOperations {
  function managedLesson<T>(
    actor: Actor,
    communityId: string,
    lessonId: string,
    action: "create" | "update" | "publish" | "delete",
    fn: (access: Access, course: CourseRecord, lesson: LessonRecord) => Promise<T>,
  ): Promise<T> {
    return withWriteAccess(runtime, actor, communityId, async (access) => {
      assertCan(actor, action, "lesson", access.context);
      const { course, lesson } = await requireLesson(access, lessonId);
      return fn(access, course, lesson);
    });
  }

  function setStatus(
    actor: Actor,
    communityId: string,
    lessonId: string,
    status: "draft" | "published",
  ): Promise<LessonView> {
    return managedLesson(actor, communityId, lessonId, "publish", async (access, _, lesson) =>
      toLessonView(await access.store.updateLesson(lesson.id, { status })),
    );
  }

  return {
    createLesson(actor, communityId, courseSlug, moduleId, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "lesson", access.context);
        const fields = parse(createLessonInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const module = await requireModule(access, course, moduleId);
        checkAttachments(access.community.id, course.id, fields.attachments);
        const position = appendPosition(await access.store.lastLessonPosition(module.id));
        const lesson = await insertWithSlug(
          fields.title,
          "lesson",
          (root) => access.store.lessonSlugsLike(course.id, root),
          (slug) =>
            access.store.insertLesson({
              courseId: course.id,
              moduleId: module.id,
              slug,
              title: fields.title,
              bodyMarkdown: fields.bodyMarkdown ?? null,
              videoUrl: fields.videoUrl ?? null,
              attachments: fields.attachments ?? [],
              position,
            }),
        );
        return toLessonView(lesson);
      });
    },

    updateLesson(actor, communityId, lessonId, input) {
      return managedLesson(
        actor,
        communityId,
        lessonId,
        "update",
        async (access, course, lesson) => {
          const { moduleId, ...fields } = parse(updateLessonInputSchema, input);
          checkAttachments(access.community.id, course.id, fields.attachments);
          const patch: LessonPatch = { ...fields };
          if (fields.title !== undefined && lesson.status === "draft") {
            patch.slug = await slugForDraft(access, lesson, fields.title);
          }
          if (moduleId !== undefined && moduleId !== lesson.moduleId) {
            const target = await requireModule(access, course, moduleId);
            patch.moduleId = target.id;
            patch.position = appendPosition(await access.store.lastLessonPosition(target.id));
          }
          return toLessonView(await access.store.updateLesson(lesson.id, patch));
        },
      );
    },

    publishLesson(actor, communityId, lessonId) {
      return setStatus(actor, communityId, lessonId, "published");
    },

    unpublishLesson(actor, communityId, lessonId) {
      return setStatus(actor, communityId, lessonId, "draft");
    },

    deleteLesson(actor, communityId, lessonId) {
      return managedLesson(actor, communityId, lessonId, "delete", (access, _, lesson) =>
        access.store.deleteLesson(lesson.id),
      );
    },

    moveLesson(actor, communityId, lessonId, input) {
      return managedLesson(
        actor,
        communityId,
        lessonId,
        "update",
        async (access, course, lesson) => {
          const { moduleId, position } = parse(moveLessonInputSchema, input);
          const target = await requireModule(access, course, moduleId);
          const siblings = (await access.store.listLessons(course.id, "all")).filter(
            (row) => row.moduleId === target.id && row.id !== lesson.id,
          );
          const moved =
            lesson.moduleId === target.id
              ? lesson
              : await access.store.updateLesson(lesson.id, {
                  moduleId: target.id,
                  position: appendPosition(siblings.at(-1)?.position ?? null),
                });
          const ordered = siblings.map((row) => row.id);
          ordered.splice(Math.min(position ?? ordered.length, ordered.length), 0, moved.id);
          await access.store.setLessonPositions(planReorder([...siblings, moved], ordered));
          return courseDetail(access, course);
        },
      );
    },

    duplicateLesson(actor, communityId, lessonId) {
      return managedLesson(
        actor,
        communityId,
        lessonId,
        "create",
        async (access, course, lesson) => {
          const title = copyTitle(lesson.title);
          const siblings = (await access.store.listLessons(course.id, "all")).filter(
            (row) => row.moduleId === lesson.moduleId,
          );
          const copy = await insertWithSlug(
            title,
            "lesson",
            (root) => access.store.lessonSlugsLike(course.id, root),
            (slug) =>
              access.store.insertLesson({
                courseId: course.id,
                moduleId: lesson.moduleId,
                slug,
                title,
                bodyMarkdown: lesson.bodyMarkdown,
                videoUrl: lesson.videoUrl,
                attachments: lesson.attachments,
                position: appendPosition(siblings.at(-1)?.position ?? null),
              }),
          );
          const ordered = siblings.map((row) => row.id);
          ordered.splice(ordered.indexOf(lesson.id) + 1, 0, copy.id);
          const updates = planReorder([...siblings, copy], ordered);
          await access.store.setLessonPositions(updates);
          const position = updates.find((row) => row.id === copy.id)?.position ?? copy.position;
          return toLessonView({ ...copy, position });
        },
      );
    },

    reorderLessons(actor, communityId, courseSlug, moduleId, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "reorder", "lesson", access.context);
        const { ids } = parse(reorderInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const module = await requireModule(access, course, moduleId);
        const lessons = (await access.store.listLessons(course.id, "all")).filter(
          (lesson) => lesson.moduleId === module.id,
        );
        await access.store.setLessonPositions(planReorder(lessons, ids));
        return courseDetail(access, course);
      });
    },

    async uploadLessonAttachment(actor, communityId, courseId, upload) {
      const scope = await withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "lesson", access.context);
        const course = isUuid(courseId)
          ? await access.store.findCourseById(courseId, access.visibility)
          : null;
        if (!course) {
          throw new CourseNotFoundError("course");
        }
        return { communityId: access.community.id, courseId: course.id };
      });
      const file = validateAttachment(upload);
      await runtime.uploadGuard(scope.communityId, file.size);
      const key = courseAttachmentKey(
        scope.communityId,
        scope.courseId,
        runtime.newId(),
        file.extension,
      );
      await runtime.storage.put({ key, body: upload.bytes, contentType: file.contentType });
      return { key, name: file.name, size: file.size, contentType: file.contentType };
    },

    getLessonAttachment(actor, communityId, key) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const lesson = await access.store.findLessonByAttachmentKey(key, access.visibility);
        const ref = lesson?.attachments.find((attachment) => attachment.key === key);
        const course = lesson
          ? await access.store.findCourseById(lesson.courseId, access.visibility)
          : null;
        if (
          !lesson ||
          !ref ||
          !course ||
          !isCourseAttachmentKey(key, access.community.id, lesson.courseId) ||
          (await access.isLocked(course))
        ) {
          throw new CourseNotFoundError("attachment");
        }
        return ref;
      });
    },
  };
}
