import {
  appendOutbox,
  getCommunityById,
  headlineOptions,
  newId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  tsQuery,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { communityAccessIn, memberLevelIn } from "@cohory/entitlements/access";
import { courseEventsTopic } from "@cohory/events/course-events";
import {
  courseAgentVersions,
  courseModules,
  courses,
  lessonAgentLayers,
  lessonProgress,
  lessons,
} from "@cohory/db/schema";
import { and, asc, desc, eq, isNotNull, max, or, sql, type SQL } from "drizzle-orm";

import type { Positioned } from "./positions";
import type { CoursesRepository, CoursesStore, Visibility } from "./repository";

function likeRoot(root: string): string {
  return `${root.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`;
}

function publishedCourse(visibility: Visibility): SQL | undefined {
  return visibility === "published" ? eq(courses.status, "published") : undefined;
}

function publishedLesson(visibility: Visibility): SQL | undefined {
  return visibility === "published" ? eq(lessons.status, "published") : undefined;
}

function createStore(queries: ScopedQueries): CoursesStore {
  const { tx, where, values, communityId } = queries;
  async function first<T>(rows: Promise<T[]>): Promise<T | null> {
    return (await rows)[0] ?? null;
  }

  async function required<T>(rows: Promise<T[]>): Promise<T> {
    const row = (await rows)[0];
    if (!row) {
      throw new Error("write returned no row");
    }
    return row;
  }

  async function setPositions(
    table: typeof courseModules | typeof lessons,
    updates: readonly Positioned[],
  ): Promise<void> {
    for (const update of updates) {
      await tx
        .update(table)
        .set({ position: update.position })
        .where(where(table, eq(table.id, update.id)));
    }
  }

  function lessonQuery(visibility: Visibility, ...conditions: (SQL | undefined)[]) {
    return tx
      .select({ lesson: lessons })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .where(
        where(lessons, publishedLesson(visibility), publishedCourse(visibility), ...conditions),
      );
  }

  const versionListing = {
    id: courseAgentVersions.id,
    courseId: courseAgentVersions.courseId,
    version: courseAgentVersions.version,
    major: courseAgentVersions.major,
    minor: courseAgentVersions.minor,
    patch: courseAgentVersions.patch,
    changelog: courseAgentVersions.changelog,
    checksum: courseAgentVersions.checksum,
    publishedBy: courseAgentVersions.publishedBy,
    createdAt: courseAgentVersions.createdAt,
  };
  const newestFirst = [
    desc(courseAgentVersions.major),
    desc(courseAgentVersions.minor),
    desc(courseAgentVersions.patch),
  ];

  return {
    findLessonAgentLayer(lessonId) {
      return first(
        tx
          .select()
          .from(lessonAgentLayers)
          .where(where(lessonAgentLayers, eq(lessonAgentLayers.lessonId, lessonId)))
          .limit(1),
      );
    },

    listLessonAgentLayers(courseId) {
      return tx
        .select()
        .from(lessonAgentLayers)
        .where(where(lessonAgentLayers, eq(lessonAgentLayers.courseId, courseId)));
    },

    saveLessonAgentLayer({ lessonId, courseId, layer, updatedBy }) {
      return required(
        tx
          .insert(lessonAgentLayers)
          .values(values({ lessonId, courseId, layer, updatedBy }))
          .onConflictDoUpdate({
            target: lessonAgentLayers.lessonId,
            set: { layer, updatedBy, updatedAt: new Date() },
            setWhere: eq(lessonAgentLayers.communityId, communityId),
          })
          .returning(),
      );
    },

    async deleteLessonAgentLayer(lessonId) {
      await tx
        .delete(lessonAgentLayers)
        .where(where(lessonAgentLayers, eq(lessonAgentLayers.lessonId, lessonId)));
    },

    async listAgentVersions(courseId) {
      const rows = await tx
        .select(versionListing)
        .from(courseAgentVersions)
        .where(where(courseAgentVersions, eq(courseAgentVersions.courseId, courseId)))
        .orderBy(...newestFirst);
      return rows.map((row) => ({ ...row, communityId }));
    },

    findAgentVersion(courseId, version) {
      return first(
        tx
          .select()
          .from(courseAgentVersions)
          .where(
            where(
              courseAgentVersions,
              eq(courseAgentVersions.courseId, courseId),
              version === null ? undefined : eq(courseAgentVersions.version, version),
            ),
          )
          .orderBy(...newestFirst)
          .limit(1),
      );
    },

    async insertAgentVersion(version) {
      const rows = await tx
        .insert(courseAgentVersions)
        .values(values(version))
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },

    searchPublishedLessons(query, limit) {
      const q = tsQuery(query);
      const rank = sql<number>`ts_rank(${lessons.searchVector}, ${q})`.mapWith(Number);
      return tx
        .select({
          courseSlug: courses.slug,
          courseTitle: courses.title,
          lessonSlug: lessons.slug,
          lessonTitle: lessons.title,
          headline: sql<string>`ts_headline('simple', coalesce(${lessons.bodyMarkdown}, ''), ${q}, ${headlineOptions})`,
          rank,
        })
        .from(lessons)
        .innerJoin(
          courses,
          and(eq(courses.id, lessons.courseId), eq(courses.communityId, lessons.communityId)),
        )
        .where(
          where(
            lessons,
            eq(lessons.status, "published"),
            eq(courses.status, "published"),
            sql`${lessons.searchVector} @@ ${q}`,
          ),
        )
        .orderBy(sql`${rank} desc`, sql`${lessons.title} asc`, sql`${lessons.id} asc`)
        .limit(limit);
    },

    findAccess(userId, now) {
      return communityAccessIn(queries, userId, now);
    },

    findLevel(userId) {
      return memberLevelIn(queries, userId);
    },

    async enableManagement() {
      await setRlsFlag(tx, "course_manager");
    },

    listCourses(visibility) {
      return tx
        .select()
        .from(courses)
        .where(where(courses, publishedCourse(visibility)))
        .orderBy(asc(courses.position), asc(courses.createdAt), asc(courses.id));
    },

    courseStats(visibility, userId) {
      const completed = userId
        ? sql<number>`count(*) filter (where ${lessons.status} = 'published' and ${lessonProgress.completedAt} is not null)`
        : sql<number>`0`;
      const query = tx
        .select({
          courseId: lessons.courseId,
          lessonCount: sql<number>`count(*)`.mapWith(Number),
          publishedLessonCount:
            sql<number>`count(*) filter (where ${lessons.status} = 'published')`.mapWith(Number),
          completedPublishedCount: completed.mapWith(Number),
        })
        .from(lessons)
        .leftJoin(
          lessonProgress,
          and(
            eq(lessonProgress.lessonId, lessons.id),
            userId ? eq(lessonProgress.userId, userId) : sql`false`,
          ),
        )
        .where(where(lessons, publishedLesson(visibility)))
        .groupBy(lessons.courseId);
      return query;
    },

    findCourseBySlug(slug, visibility) {
      return first(
        tx
          .select()
          .from(courses)
          .where(where(courses, eq(courses.slug, slug), publishedCourse(visibility)))
          .limit(1),
      );
    },

    findCourseById(courseId, visibility) {
      return first(
        tx
          .select()
          .from(courses)
          .where(where(courses, eq(courses.id, courseId), publishedCourse(visibility)))
          .limit(1),
      );
    },

    async courseSlugsLike(root) {
      const rows = await tx
        .select({ slug: courses.slug })
        .from(courses)
        .where(
          where(courses, or(eq(courses.slug, root), sql`${courses.slug} like ${likeRoot(root)}`)),
        );
      return rows.map((row) => row.slug);
    },

    async lastCoursePosition() {
      const [row] = await tx
        .select({ value: max(courses.position) })
        .from(courses)
        .where(where(courses));
      return row?.value ?? null;
    },

    insertCourse(course) {
      return first(tx.insert(courses).values(values(course)).onConflictDoNothing().returning());
    },

    updateCourse(courseId, patch) {
      return required(
        tx
          .update(courses)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(courses, eq(courses.id, courseId)))
          .returning(),
      );
    },

    async appendCourseEvents(events) {
      if (events.length === 0) {
        return;
      }
      await appendOutbox(tx, {
        id: newId(),
        communityId,
        topic: courseEventsTopic,
        payload: { events },
      });
    },

    async deleteCourse(courseId) {
      await tx.delete(courses).where(where(courses, eq(courses.id, courseId)));
    },

    async courseHasProgress(courseId) {
      const [row] = await tx
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(where(lessonProgress, eq(lessonProgress.courseId, courseId)))
        .limit(1);
      return row !== undefined;
    },

    listModules(courseId) {
      return tx
        .select()
        .from(courseModules)
        .where(where(courseModules, eq(courseModules.courseId, courseId)))
        .orderBy(asc(courseModules.position), asc(courseModules.id));
    },

    findModule(courseId, moduleId) {
      return first(
        tx
          .select()
          .from(courseModules)
          .where(
            where(
              courseModules,
              eq(courseModules.courseId, courseId),
              eq(courseModules.id, moduleId),
            ),
          )
          .limit(1),
      );
    },

    async lastModulePosition(courseId) {
      const [row] = await tx
        .select({ value: max(courseModules.position) })
        .from(courseModules)
        .where(where(courseModules, eq(courseModules.courseId, courseId)));
      return row?.value ?? null;
    },

    insertModule(module) {
      return required(tx.insert(courseModules).values(values(module)).returning());
    },

    updateModule(moduleId, title) {
      return required(
        tx
          .update(courseModules)
          .set({ title, updatedAt: new Date() })
          .where(where(courseModules, eq(courseModules.id, moduleId)))
          .returning(),
      );
    },

    async deleteModule(moduleId) {
      await tx.delete(courseModules).where(where(courseModules, eq(courseModules.id, moduleId)));
    },

    setModulePositions(updates) {
      return setPositions(courseModules, updates);
    },

    async listLessons(courseId, visibility) {
      const rows = await lessonQuery(visibility, eq(lessons.courseId, courseId)).orderBy(
        asc(courseModules.position),
        asc(courseModules.id),
        asc(lessons.position),
        asc(lessons.id),
      );
      return rows.map((row) => row.lesson);
    },

    async findLessonBySlug(courseId, slug, visibility) {
      const row = await first(
        lessonQuery(visibility, eq(lessons.courseId, courseId), eq(lessons.slug, slug)).limit(1),
      );
      return row?.lesson ?? null;
    },

    async findVisibleLesson(lessonId, visibility) {
      const row = await first(lessonQuery(visibility, eq(lessons.id, lessonId)).limit(1));
      return row?.lesson ?? null;
    },

    async findLessonByAttachmentKey(key, visibility) {
      const needle = JSON.stringify([{ key }]);
      const row = await first(
        lessonQuery(visibility, sql`${lessons.attachments} @> ${needle}::jsonb`).limit(1),
      );
      return row?.lesson ?? null;
    },

    async lessonSlugsLike(courseId, root) {
      const rows = await tx
        .select({ slug: lessons.slug })
        .from(lessons)
        .where(
          where(
            lessons,
            eq(lessons.courseId, courseId),
            or(eq(lessons.slug, root), sql`${lessons.slug} like ${likeRoot(root)}`),
          ),
        );
      return rows.map((row) => row.slug);
    },

    async lastLessonPosition(moduleId) {
      const [row] = await tx
        .select({ value: max(lessons.position) })
        .from(lessons)
        .where(where(lessons, eq(lessons.moduleId, moduleId)));
      return row?.value ?? null;
    },

    insertLesson(lesson) {
      return first(tx.insert(lessons).values(values(lesson)).onConflictDoNothing().returning());
    },

    updateLesson(lessonId, patch) {
      return required(
        tx
          .update(lessons)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(lessons, eq(lessons.id, lessonId)))
          .returning(),
      );
    },

    async deleteLesson(lessonId) {
      await tx.delete(lessons).where(where(lessons, eq(lessons.id, lessonId)));
    },

    setLessonPositions(updates) {
      return setPositions(lessons, updates);
    },

    progressFor(userId, courseId) {
      return tx
        .select()
        .from(lessonProgress)
        .where(
          where(
            lessonProgress,
            eq(lessonProgress.userId, userId),
            eq(lessonProgress.courseId, courseId),
          ),
        );
    },

    async recentCourseIds(userId, limit) {
      const lastViewed = max(lessonProgress.lastViewedAt);
      const rows = await tx
        .select({ courseId: lessonProgress.courseId })
        .from(lessonProgress)
        .innerJoin(courses, eq(courses.id, lessonProgress.courseId))
        .where(
          where(
            lessonProgress,
            eq(lessonProgress.userId, userId),
            eq(courses.status, "published"),
            isNotNull(lessonProgress.lastViewedAt),
          ),
        )
        .groupBy(lessonProgress.courseId)
        .orderBy(desc(lastViewed))
        .limit(limit);
      return rows.map((row) => row.courseId);
    },

    async writeProgress({ userId, lessonId, courseId, at, completed }) {
      const completedAt = completed === undefined ? undefined : completed ? at : null;
      await tx
        .insert(lessonProgress)
        .values(
          values({
            userId,
            lessonId,
            courseId,
            lastViewedAt: at,
            completedAt: completedAt ?? null,
          }),
        )
        .onConflictDoUpdate({
          target: [lessonProgress.lessonId, lessonProgress.userId],
          set:
            completed === undefined
              ? { lastViewedAt: at }
              : completed
                ? {
                    completedAt: sql`coalesce(${lessonProgress.completedAt}, ${at.toISOString()}::timestamptz)`,
                  }
                : { completedAt: null },
        });
    },
  };
}

export function createPostgresCoursesRepository(db: Database): CoursesRepository {
  return {
    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? {
            id: community.id,
            slug: community.slug,
            privacy: community.privacy,
            archivedAt: community.archivedAt,
            gamificationEnabled: community.gamificationEnabled,
          }
        : null;
    },

    inCommunity(communityId, userId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        if (userId) {
          await setRlsValue(queries.tx, "user_id", userId);
        }
        return fn(createStore(queries));
      });
    },
  };
}
