import { assertCan, type Actor } from "@cohory/authz";
import { isCommunityArchived } from "@cohory/communities/archive";
import { embedProviderOf } from "@cohory/posts";

import { CourseNotFoundError } from "../errors";
import { renderLessonHtml } from "../markdown";
import { progressPercent } from "../progress";
import type { CourseRecord, LessonRecord } from "../repository";
import type { ContinueLearning, CourseProgress, LessonDetail, LessonLink } from "../views";
import {
  assertNotDelegatedAgent,
  isUuid,
  requireUserId,
  withAccess,
  withWriteAccess,
  unlockedOnly,
  type Access,
  type Runtime,
} from "./context";
import { assertUnlocked, completedIds, requireCourse, statsFor, toLessonView } from "./outline";

const continueLearningCourses = 10;

export interface LearningOperations {
  getLesson(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    lessonSlug: string,
  ): Promise<LessonDetail>;
  markLessonComplete(actor: Actor, communityId: string, lessonId: string): Promise<CourseProgress>;
  markLessonIncomplete(
    actor: Actor,
    communityId: string,
    lessonId: string,
  ): Promise<CourseProgress>;
  recordLessonView(actor: Actor, communityId: string, lessonId: string): Promise<void>;
  getContinueLearning(actor: Actor, communityId: string): Promise<ContinueLearning | null>;
}

function link(lesson: LessonRecord | undefined): LessonLink | null {
  return lesson ? { id: lesson.id, slug: lesson.slug, title: lesson.title } : null;
}

function courseRef(course: CourseRecord) {
  return { id: course.id, slug: course.slug, title: course.title };
}

async function requireVisibleLesson(access: Access, lessonId: string): Promise<LessonRecord> {
  const lesson = isUuid(lessonId)
    ? await access.store.findVisibleLesson(lessonId, access.visibility)
    : null;
  const course = lesson
    ? await access.store.findCourseById(lesson.courseId, access.visibility)
    : null;
  if (!lesson || !course) {
    throw new CourseNotFoundError("lesson");
  }
  await assertUnlocked(access, course, "lesson");
  return lesson;
}

export function createLearningOperations(runtime: Runtime): LearningOperations {
  async function setCompletion(
    actor: Actor,
    communityId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<CourseProgress> {
    const userId = requireUserId(actor);
    return withWriteAccess(runtime, actor, communityId, async (access) => {
      assertNotDelegatedAgent(access);
      assertCan(actor, "update_progress", "lesson", access.context);
      const lesson = await requireVisibleLesson(access, lessonId);
      await access.store.writeProgress({
        userId,
        lessonId: lesson.id,
        courseId: lesson.courseId,
        at: runtime.now(),
        completed,
      });
      const lessons = await access.store.listLessons(lesson.courseId, access.visibility);
      const done = completedIds(await access.store.progressFor(userId, lesson.courseId));
      const published = lessons.filter((row) => row.status === "published");
      const completedCount = published.filter((row) => done.has(row.id)).length;
      return {
        courseId: lesson.courseId,
        lessonId: lesson.id,
        completed,
        completedLessonCount: completedCount,
        publishedLessonCount: published.length,
        progressPercent: progressPercent(completedCount, published.length),
      };
    });
  }

  return {
    getLesson(actor, communityId, courseSlug, lessonSlug) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const course = await requireCourse(access, courseSlug, { lockedAs: "lesson" });
        const lesson =
          lessonSlug.length > 0 && lessonSlug.length <= 200
            ? await access.store.findLessonBySlug(course.id, lessonSlug, access.visibility)
            : null;
        if (!lesson) {
          throw new CourseNotFoundError("lesson");
        }
        const ordered = await access.store.listLessons(course.id, access.visibility);
        const index = ordered.findIndex((row) => row.id === lesson.id);
        const progress = access.viewerId
          ? await access.store.progressFor(access.viewerId, course.id)
          : [];
        return {
          ...toLessonView(lesson),
          bodyHtml: renderLessonHtml(lesson.bodyMarkdown, { imageHosts: runtime.imageHosts }),
          videoProvider: lesson.videoUrl ? embedProviderOf(lesson.videoUrl) : null,
          course: courseRef(course),
          previousLesson: link(index > 0 ? ordered[index - 1] : undefined),
          nextLesson: link(index >= 0 ? ordered[index + 1] : undefined),
          completedAt: progress.find((row) => row.lessonId === lesson.id)?.completedAt ?? null,
        };
      });
    },

    markLessonComplete(actor, communityId, lessonId) {
      return setCompletion(actor, communityId, lessonId, true);
    },

    markLessonIncomplete(actor, communityId, lessonId) {
      return setCompletion(actor, communityId, lessonId, false);
    },

    async recordLessonView(actor, communityId, lessonId) {
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertNotDelegatedAgent(access);
        assertCan(actor, "update_progress", "lesson", access.context);
        const lesson = await requireVisibleLesson(access, lessonId);
        if (isCommunityArchived(access.community)) {
          return;
        }
        await access.store.writeProgress({
          userId,
          lessonId: lesson.id,
          courseId: lesson.courseId,
          at: runtime.now(),
        });
      });
    },

    async getContinueLearning(actor, communityId) {
      if (actor.kind !== "user") {
        return null;
      }
      const userId = actor.userId;
      return withAccess(runtime, actor, communityId, async (access) => {
        const { store, agentCourseIds } = access;
        if (agentCourseIds !== null) {
          return null;
        }
        const recent = await store.recentCourseIds(userId, continueLearningCourses);
        if (recent.length === 0) {
          return null;
        }
        const [published, stats] = await Promise.all([
          store.listCourses("published"),
          store.courseStats("published", userId),
        ]);
        const open = await unlockedOnly(access, published);
        const coursesById = new Map(open.map((course) => [course.id, course]));
        const unfinished = new Set(
          stats
            .filter((row) => row.completedPublishedCount < row.publishedLessonCount)
            .map((row) => row.courseId),
        );
        const course = recent
          .filter((courseId) => unfinished.has(courseId))
          .map((courseId) => coursesById.get(courseId))
          .find((candidate) => candidate !== undefined);
        if (!course) {
          return null;
        }
        const [lessons, progress] = await Promise.all([
          store.listLessons(course.id, "published"),
          store.progressFor(userId, course.id),
        ]);
        const done = completedIds(progress);
        const visible = new Set(lessons.map((lesson) => lesson.id));
        const latest = progress
          .filter((row) => visible.has(row.lessonId))
          .sort((a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime())[0];
        const next =
          latest && !done.has(latest.lessonId)
            ? lessons.find((lesson) => lesson.id === latest.lessonId)
            : lessons.find((lesson) => !done.has(lesson.id));
        if (!next) {
          return null;
        }
        const courseStats = statsFor(course, lessons, done);
        return {
          course: courseRef(course),
          lesson: { id: next.id, slug: next.slug, title: next.title },
          progressPercent: progressPercent(
            courseStats.completedPublishedCount,
            courseStats.publishedLessonCount,
          ),
        };
      });
    },
  };
}
