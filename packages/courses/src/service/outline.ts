import { contentTypeForKey, isCourseAttachmentKey, isStorageKey } from "@cohory/storage";

import { CourseNotFoundError, CoursesValidationError } from "../errors";
import { progressPercent } from "../progress";
import type {
  CourseRecord,
  CourseStats,
  LessonRecord,
  ModuleRecord,
  ProgressRecord,
} from "../repository";
import { nextFreeSlug, slugify } from "../slug";
import type {
  AttachmentRef,
  CourseDetail,
  CourseSummary,
  LessonSummary,
  LessonView,
} from "../views";
import { isUuid, type Access } from "./context";

const maxSlugAttempts = 5;

export interface CourseLock {
  readonly requiredLevel: number | null;
  readonly locked: boolean;
}

export async function lockOf(access: Access, course: CourseRecord): Promise<CourseLock> {
  return { requiredLevel: access.requiredLevelOf(course), locked: await access.isLocked(course) };
}

export function toSummary(
  course: CourseRecord,
  stats: CourseStats | undefined,
  lock: CourseLock,
): CourseSummary {
  const published = stats?.publishedLessonCount ?? 0;
  const completed = stats?.completedPublishedCount ?? 0;
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    coverKey: course.coverKey,
    status: course.status,
    position: course.position,
    lessonCount: stats?.lessonCount ?? 0,
    publishedLessonCount: published,
    completedLessonCount: completed,
    progressPercent: progressPercent(completed, published),
    requiredLevel: lock.requiredLevel,
    locked: lock.locked,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

export function toLessonView(lesson: LessonRecord): LessonView {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    slug: lesson.slug,
    title: lesson.title,
    status: lesson.status,
    position: lesson.position,
    bodyMarkdown: lesson.bodyMarkdown,
    videoUrl: lesson.videoUrl,
    attachments: lesson.attachments,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

export function completedIds(progress: readonly ProgressRecord[]): Set<string> {
  return new Set(progress.filter((row) => row.completedAt !== null).map((row) => row.lessonId));
}

export function statsFor(
  course: CourseRecord,
  lessons: readonly LessonRecord[],
  completed: ReadonlySet<string>,
): CourseStats {
  const published = lessons.filter((lesson) => lesson.status === "published");
  return {
    courseId: course.id,
    lessonCount: lessons.length,
    publishedLessonCount: published.length,
    completedPublishedCount: published.filter((lesson) => completed.has(lesson.id)).length,
  };
}

function toLessonSummary(lesson: LessonRecord, completed: ReadonlySet<string>): LessonSummary {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    slug: lesson.slug,
    title: lesson.title,
    status: lesson.status,
    position: lesson.position,
    hasVideo: lesson.videoUrl !== null,
    completed: completed.has(lesson.id),
  };
}

export async function courseDetail(access: Access, course: CourseRecord): Promise<CourseDetail> {
  const { store, viewerId, visibility } = access;
  const lock = await lockOf(access, course);
  const modules: ModuleRecord[] = lock.locked ? [] : await store.listModules(course.id);
  const lessons = await store.listLessons(course.id, visibility);
  const completed = completedIds(viewerId ? await store.progressFor(viewerId, course.id) : []);
  return {
    ...toSummary(course, statsFor(course, lessons, completed), lock),
    modules: modules.map((module) => ({
      id: module.id,
      courseId: module.courseId,
      title: module.title,
      position: module.position,
      lessons: lessons
        .filter((lesson) => lesson.moduleId === module.id)
        .map((lesson) => toLessonSummary(lesson, completed)),
    })),
  };
}

export async function requireCourse(
  access: Access,
  courseSlug: string,
  options: { readonly allowLocked?: boolean; readonly lockedAs?: "course" | "lesson" } = {},
): Promise<CourseRecord> {
  const course =
    courseSlug.length > 0 && courseSlug.length <= 200
      ? await access.store.findCourseBySlug(courseSlug, access.visibility)
      : null;
  if (!course) {
    throw new CourseNotFoundError("course");
  }
  await access.assertCourseReadable(course.id);
  if (!options.allowLocked) {
    await assertUnlocked(access, course, options.lockedAs);
  }
  return course;
}

export async function assertUnlocked(
  access: Access,
  course: Pick<CourseRecord, "requiredLevel">,
  subject: "course" | "lesson" = "course",
): Promise<void> {
  if (await access.isLocked(course)) {
    throw new CourseNotFoundError(subject);
  }
}

export async function requireModule(
  access: Access,
  course: CourseRecord,
  moduleId: string,
): Promise<ModuleRecord> {
  const module = isUuid(moduleId) ? await access.store.findModule(course.id, moduleId) : null;
  if (!module) {
    throw new CourseNotFoundError("module");
  }
  return module;
}

export async function insertWithSlug<T>(
  title: string,
  kind: "course" | "lesson",
  taken: (root: string) => Promise<string[]>,
  insert: (slug: string) => Promise<T | null>,
): Promise<T> {
  const root = slugify(title) || kind;
  for (let attempt = 0; attempt < maxSlugAttempts; attempt += 1) {
    const row = await insert(nextFreeSlug(root, kind, await taken(root)));
    if (row) {
      return row;
    }
  }
  throw new Error(`could not find a free ${kind} slug`);
}

const coverTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function checkCoverKey(communityId: string, key: string | null | undefined): void {
  if (key === null || key === undefined) {
    return;
  }
  const valid =
    isStorageKey(key) &&
    key.startsWith(`communities/${communityId}/`) &&
    coverTypes.has(contentTypeForKey(key) ?? "");
  if (!valid) {
    throw new CoursesValidationError([
      { path: "coverKey", message: "Upload the cover image to this community first." },
    ]);
  }
}

export function checkAttachments(
  communityId: string,
  courseId: string,
  attachments: readonly AttachmentRef[] | undefined,
): void {
  attachments?.forEach((attachment, index) => {
    const valid =
      isCourseAttachmentKey(attachment.key, communityId, courseId) &&
      contentTypeForKey(attachment.key) === attachment.contentType;
    if (!valid) {
      throw new CoursesValidationError([
        {
          path: `attachments.${index}.key`,
          message: "Upload the attachment to this course first.",
        },
      ]);
    }
  });
}
