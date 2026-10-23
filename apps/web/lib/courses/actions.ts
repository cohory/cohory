"use server";

import { getCoursesService, getPostsService } from "@cohory/api/services";
import type { CourseProgress } from "@cohory/courses";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { appUrl } from "../manage/views";
import { resolveCommunity, type CommunityContext } from "../posts/context";
import { actionFailure } from "../posts/errors";
import { courseAnnouncement } from "./announcement";
import { courseActionFailure, type CourseActionResult } from "./errors";
import { classroomHref, courseHref } from "./hrefs";
import {
  courseRefSchema,
  createCourseSchema,
  createLessonSchema,
  createModuleSchema,
  lessonRefSchema,
  moduleRefSchema,
  moveLessonSchema,
  publishCourseSchema,
  recordViewSchema,
  renameModuleSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  setLessonCompleteSchema,
  setLessonPublishedSchema,
  updateCourseSchema,
  updateLessonSchema,
  type CourseRefInput,
  type CreateCourseInput,
  type CreateLessonInput,
  type CreateModuleInput,
  type LessonRefInput,
  type ModuleRefInput,
  type MoveLessonInput,
  type PublishCourseInput,
  type RecordViewInput,
  type RenameModuleInput,
  type ReorderLessonsInput,
  type ReorderModulesInput,
  type SetLessonCompleteInput,
  type SetLessonPublishedInput,
  type UpdateCourseInput,
  type UpdateLessonInput,
} from "./schemas";

async function run<I extends { slug: string }, T>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, context: CommunityContext) => Promise<T>,
): Promise<CourseActionResult<T>> {
  try {
    const input = schema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return { ok: true, data: await fn(input, context) };
  } catch (error) {
    const failure = courseActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

function revalidateClassroom(context: CommunityContext): void {
  revalidatePath(classroomHref(context.slug), "layout");
}

const courses = getCoursesService;

export async function createCourseAction(
  raw: CreateCourseInput,
): Promise<CourseActionResult<{ courseSlug: string }>> {
  return run(createCourseSchema, raw, async (input, context) => {
    const { actor } = context.access;
    const course = await courses().createCourse(actor, context.communityId, {
      title: input.title,
      description: input.description,
      coverKey: input.coverKey,
    });
    await courses().createModule(actor, context.communityId, course.slug, { title: "Module 1" });
    revalidateClassroom(context);
    return { courseSlug: course.slug };
  });
}

export async function updateCourseAction(
  raw: UpdateCourseInput,
): Promise<CourseActionResult<{ courseSlug: string }>> {
  return run(updateCourseSchema, raw, async (input, context) => {
    const course = await courses().updateCourse(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      {
        title: input.title,
        description: input.description,
        coverKey: input.coverKey,
        requiredLevel: input.requiredLevel,
      },
    );
    revalidateClassroom(context);
    return { courseSlug: course.slug };
  });
}

export async function publishCourseAction(
  raw: PublishCourseInput,
): Promise<CourseActionResult<{ announced: boolean }>> {
  return run(publishCourseSchema, raw, async (input, context) => {
    const { actor } = context.access;
    const course = await courses().publishCourse(actor, context.communityId, input.courseSlug, {
      publishDraftLessons: input.publishDraftLessons,
    });
    revalidateClassroom(context);
    if (!input.announce) return { announced: false };
    try {
      await getPostsService().createPost(
        actor,
        context.communityId,
        courseAnnouncement({
          title: course.title,
          description: course.description,
          url: `${appUrl()}${courseHref(context.slug, course.slug)}`,
        }),
      );
    } catch (error) {
      if (actionFailure(error)) return { announced: false };
      throw error;
    }
    revalidatePath(`/c/${context.slug}`, "layout");
    return { announced: true };
  });
}

export async function unpublishCourseAction(
  raw: CourseRefInput,
): Promise<CourseActionResult<null>> {
  return run(courseRefSchema, raw, async (input, context) => {
    await courses().unpublishCourse(context.access.actor, context.communityId, input.courseSlug);
    revalidateClassroom(context);
    return null;
  });
}

export async function deleteCourseAction(
  raw: CourseRefInput,
): Promise<CourseActionResult<{ outcome: string }>> {
  return run(courseRefSchema, raw, async (input, context) => {
    const result = await courses().deleteCourse(
      context.access.actor,
      context.communityId,
      input.courseSlug,
    );
    revalidateClassroom(context);
    return { outcome: result.outcome };
  });
}

export async function createModuleAction(
  raw: CreateModuleInput,
): Promise<CourseActionResult<{ id: string }>> {
  return run(createModuleSchema, raw, async (input, context) => {
    const created = await courses().createModule(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      { title: input.title },
    );
    revalidateClassroom(context);
    return { id: created.id };
  });
}

export async function renameModuleAction(
  raw: RenameModuleInput,
): Promise<CourseActionResult<null>> {
  return run(renameModuleSchema, raw, async (input, context) => {
    await courses().updateModule(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      input.moduleId,
      { title: input.title },
    );
    revalidateClassroom(context);
    return null;
  });
}

export async function deleteModuleAction(raw: ModuleRefInput): Promise<CourseActionResult<null>> {
  return run(moduleRefSchema, raw, async (input, context) => {
    await courses().deleteModule(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      input.moduleId,
    );
    revalidateClassroom(context);
    return null;
  });
}

export async function reorderModulesAction(
  raw: ReorderModulesInput,
): Promise<CourseActionResult<null>> {
  return run(reorderModulesSchema, raw, async (input, context) => {
    await courses().reorderModules(context.access.actor, context.communityId, input.courseSlug, {
      ids: input.ids,
    });
    revalidateClassroom(context);
    return null;
  });
}

export async function reorderLessonsAction(
  raw: ReorderLessonsInput,
): Promise<CourseActionResult<null>> {
  return run(reorderLessonsSchema, raw, async (input, context) => {
    await courses().reorderLessons(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      input.moduleId,
      { ids: input.ids },
    );
    revalidateClassroom(context);
    return null;
  });
}

export async function createLessonAction(
  raw: CreateLessonInput,
): Promise<CourseActionResult<{ lessonSlug: string }>> {
  return run(createLessonSchema, raw, async (input, context) => {
    const lesson = await courses().createLesson(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      input.moduleId,
      { title: input.title },
    );
    revalidateClassroom(context);
    return { lessonSlug: lesson.slug };
  });
}

export async function updateLessonAction(
  raw: UpdateLessonInput,
): Promise<CourseActionResult<{ lessonSlug: string; status: string }>> {
  return run(updateLessonSchema, raw, async (input, context) => {
    const { actor } = context.access;
    const saved = await courses().updateLesson(actor, context.communityId, input.lessonId, {
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      videoUrl: input.videoUrl,
      attachments: input.attachments,
    });
    const lesson =
      input.publish && saved.status === "draft"
        ? await courses().publishLesson(actor, context.communityId, saved.id)
        : saved;
    revalidateClassroom(context);
    return { lessonSlug: lesson.slug, status: lesson.status };
  });
}

export async function moveLessonAction(raw: MoveLessonInput): Promise<CourseActionResult<null>> {
  return run(moveLessonSchema, raw, async (input, context) => {
    await courses().moveLesson(context.access.actor, context.communityId, input.lessonId, {
      moduleId: input.moduleId,
      position: input.position,
    });
    revalidateClassroom(context);
    return null;
  });
}

export async function duplicateLessonAction(
  raw: LessonRefInput,
): Promise<CourseActionResult<{ lessonSlug: string }>> {
  return run(lessonRefSchema, raw, async (input, context) => {
    const copy = await courses().duplicateLesson(
      context.access.actor,
      context.communityId,
      input.lessonId,
    );
    revalidateClassroom(context);
    return { lessonSlug: copy.slug };
  });
}

export async function deleteLessonAction(raw: LessonRefInput): Promise<CourseActionResult<null>> {
  return run(lessonRefSchema, raw, async (input, context) => {
    await courses().deleteLesson(context.access.actor, context.communityId, input.lessonId);
    revalidateClassroom(context);
    return null;
  });
}

export async function setLessonPublishedAction(
  raw: SetLessonPublishedInput,
): Promise<CourseActionResult<{ status: string }>> {
  return run(setLessonPublishedSchema, raw, async (input, context) => {
    const service = courses();
    const args = [context.access.actor, context.communityId, input.lessonId] as const;
    const lesson = input.published
      ? await service.publishLesson(...args)
      : await service.unpublishLesson(...args);
    revalidateClassroom(context);
    return { status: lesson.status };
  });
}

export async function setLessonCompleteAction(
  raw: SetLessonCompleteInput,
): Promise<CourseActionResult<CourseProgress>> {
  return run(setLessonCompleteSchema, raw, async (input, context) => {
    const service = courses();
    const args = [context.access.actor, context.communityId, input.lessonId] as const;
    const progress = input.completed
      ? await service.markLessonComplete(...args)
      : await service.markLessonIncomplete(...args);
    revalidatePath(`/c/${context.slug}`, "layout");
    return progress;
  });
}

export async function recordLessonViewAction(
  raw: RecordViewInput,
): Promise<CourseActionResult<null>> {
  return run(recordViewSchema, raw, async (input, context) => {
    await courses().recordLessonView(context.access.actor, context.communityId, input.lessonId);
    return null;
  });
}
