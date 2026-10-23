import type { CommunityPrivacy } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";
import type { CourseEvent } from "@cohory/events/course-events";
import type {
  courseAgentVersions,
  courseModules,
  courses,
  lessonAgentLayers,
  lessonProgress,
  lessons,
} from "@cohory/db/schema";

import type { Positioned } from "./positions";

export type CourseRecord = typeof courses.$inferSelect;
export type ModuleRecord = typeof courseModules.$inferSelect;
export type LessonRecord = typeof lessons.$inferSelect;
export type ProgressRecord = typeof lessonProgress.$inferSelect;
export type LessonAgentLayerRecord = typeof lessonAgentLayers.$inferSelect;
export type AgentVersionRecord = typeof courseAgentVersions.$inferSelect;
export type AgentVersionListing = Omit<AgentVersionRecord, "snapshot">;
export type NewAgentVersion = Omit<AgentVersionRecord, "id" | "communityId" | "createdAt">;

export type Visibility = "published" | "all";

export interface CommunityRecord {
  readonly id: CommunityId;
  readonly slug: string;
  readonly privacy: CommunityPrivacy;
  readonly archivedAt: Date | null;
  readonly gamificationEnabled: boolean;
}

export interface CourseStats {
  readonly courseId: string;
  readonly lessonCount: number;
  readonly publishedLessonCount: number;
  readonly completedPublishedCount: number;
}

export type NewCourse = Pick<
  CourseRecord,
  "slug" | "title" | "description" | "coverKey" | "position" | "requiredLevel"
>;
export type CoursePatch = Partial<
  Pick<CourseRecord, "title" | "description" | "coverKey" | "status" | "requiredLevel">
>;
export type NewModule = Pick<ModuleRecord, "courseId" | "title" | "position">;
export type NewLesson = Pick<
  LessonRecord,
  | "courseId"
  | "moduleId"
  | "slug"
  | "title"
  | "bodyMarkdown"
  | "videoUrl"
  | "attachments"
  | "position"
>;
export type LessonPatch = Partial<
  Pick<
    LessonRecord,
    | "title"
    | "slug"
    | "bodyMarkdown"
    | "videoUrl"
    | "attachments"
    | "status"
    | "moduleId"
    | "position"
  >
>;

export interface ProgressWrite {
  readonly userId: string;
  readonly lessonId: string;
  readonly courseId: string;
  readonly at: Date;
  readonly completed?: boolean;
}

export interface LessonSearchRow {
  readonly courseSlug: string;
  readonly courseTitle: string;
  readonly lessonSlug: string;
  readonly lessonTitle: string;
  readonly headline: string;
  readonly rank: number;
}

export interface CoursesStore {
  findAccess(userId: string, now: Date): Promise<CommunityAccess>;
  findLevel(userId: string): Promise<number>;
  enableManagement(): Promise<void>;

  listCourses(visibility: Visibility): Promise<CourseRecord[]>;
  courseStats(visibility: Visibility, userId: string | null): Promise<CourseStats[]>;
  findCourseBySlug(slug: string, visibility: Visibility): Promise<CourseRecord | null>;
  findCourseById(courseId: string, visibility: Visibility): Promise<CourseRecord | null>;
  courseSlugsLike(root: string): Promise<string[]>;
  lastCoursePosition(): Promise<number | null>;
  insertCourse(course: NewCourse): Promise<CourseRecord | null>;
  updateCourse(courseId: string, patch: CoursePatch): Promise<CourseRecord>;
  appendCourseEvents(events: readonly CourseEvent[]): Promise<void>;
  deleteCourse(courseId: string): Promise<void>;
  courseHasProgress(courseId: string): Promise<boolean>;

  listModules(courseId: string): Promise<ModuleRecord[]>;
  findModule(courseId: string, moduleId: string): Promise<ModuleRecord | null>;
  lastModulePosition(courseId: string): Promise<number | null>;
  insertModule(module: NewModule): Promise<ModuleRecord>;
  updateModule(moduleId: string, title: string): Promise<ModuleRecord>;
  deleteModule(moduleId: string): Promise<void>;
  setModulePositions(updates: readonly Positioned[]): Promise<void>;

  listLessons(courseId: string, visibility: Visibility): Promise<LessonRecord[]>;
  findLessonBySlug(
    courseId: string,
    slug: string,
    visibility: Visibility,
  ): Promise<LessonRecord | null>;
  findVisibleLesson(lessonId: string, visibility: Visibility): Promise<LessonRecord | null>;
  findLessonByAttachmentKey(key: string, visibility: Visibility): Promise<LessonRecord | null>;
  lessonSlugsLike(courseId: string, root: string): Promise<string[]>;
  lastLessonPosition(moduleId: string): Promise<number | null>;
  insertLesson(lesson: NewLesson): Promise<LessonRecord | null>;
  updateLesson(lessonId: string, patch: LessonPatch): Promise<LessonRecord>;
  deleteLesson(lessonId: string): Promise<void>;
  setLessonPositions(updates: readonly Positioned[]): Promise<void>;

  searchPublishedLessons(tsQuery: string, limit: number): Promise<LessonSearchRow[]>;

  findLessonAgentLayer(lessonId: string): Promise<LessonAgentLayerRecord | null>;
  listLessonAgentLayers(courseId: string): Promise<LessonAgentLayerRecord[]>;
  saveLessonAgentLayer(input: {
    lessonId: string;
    courseId: string;
    layer: Record<string, unknown>;
    updatedBy: string;
  }): Promise<LessonAgentLayerRecord>;
  deleteLessonAgentLayer(lessonId: string): Promise<void>;
  listAgentVersions(courseId: string): Promise<AgentVersionListing[]>;
  findAgentVersion(courseId: string, version: string | null): Promise<AgentVersionRecord | null>;
  insertAgentVersion(version: NewAgentVersion): Promise<AgentVersionRecord | null>;

  progressFor(userId: string, courseId: string): Promise<ProgressRecord[]>;
  recentCourseIds(userId: string, limit: number): Promise<string[]>;
  writeProgress(write: ProgressWrite): Promise<void>;
}

export interface CoursesRepository {
  findCommunity(communityId: CommunityId): Promise<CommunityRecord | null>;
  inCommunity<T>(
    communityId: CommunityId,
    userId: string | null,
    fn: (store: CoursesStore) => Promise<T>,
  ): Promise<T>;
}
