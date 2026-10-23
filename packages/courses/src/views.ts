import type { CourseStatus, LessonStatus } from "@cohory/db/schema";
import type { EmbedProvider } from "@cohory/posts";

export interface AttachmentRef {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface CourseSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly coverKey: string | null;
  readonly status: CourseStatus;
  readonly position: number;
  readonly lessonCount: number;
  readonly publishedLessonCount: number;
  readonly completedLessonCount: number;
  readonly progressPercent: number;
  readonly requiredLevel: number | null;
  readonly locked: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CoursePreview {
  readonly title: string;
  readonly coverKey: string | null;
  readonly lessonCount: number;
}

export interface LessonSummary {
  readonly id: string;
  readonly moduleId: string;
  readonly slug: string;
  readonly title: string;
  readonly status: LessonStatus;
  readonly position: number;
  readonly hasVideo: boolean;
  readonly completed: boolean;
}

export interface ModuleView {
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly position: number;
  readonly lessons: readonly LessonSummary[];
}

export interface CourseDetail extends CourseSummary {
  readonly modules: readonly ModuleView[];
}

export interface LessonView {
  readonly id: string;
  readonly courseId: string;
  readonly moduleId: string;
  readonly slug: string;
  readonly title: string;
  readonly status: LessonStatus;
  readonly position: number;
  readonly bodyMarkdown: string | null;
  readonly videoUrl: string | null;
  readonly attachments: readonly AttachmentRef[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LessonLink {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

export interface LessonDetail extends LessonView {
  readonly bodyHtml: string;
  readonly videoProvider: EmbedProvider | null;
  readonly course: { readonly id: string; readonly slug: string; readonly title: string };
  readonly previousLesson: LessonLink | null;
  readonly nextLesson: LessonLink | null;
  readonly completedAt: Date | null;
}

export interface CourseProgress {
  readonly courseId: string;
  readonly lessonId: string;
  readonly completed: boolean;
  readonly completedLessonCount: number;
  readonly publishedLessonCount: number;
  readonly progressPercent: number;
}

export interface ContinueLearning {
  readonly course: { readonly id: string; readonly slug: string; readonly title: string };
  readonly lesson: LessonLink;
  readonly progressPercent: number;
}

export interface DeleteCourseResult {
  readonly outcome: "deleted" | "archived";
}
