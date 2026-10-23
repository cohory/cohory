import type {
  AttachmentRef,
  CourseSummary as CourseRecordSummary,
  ModuleView,
} from "@cohory/courses";
import type {
  CourseOutlineModule,
  EventOccurrence,
  CourseSummary,
  LessonAttachment,
  LessonPlayerProgress,
  OutlineEditorModule,
} from "@cohory/ui";

import { occurrenceHref } from "../calendar/hrefs";
import { attachmentHref, courseHref, lessonHref, uploadHref } from "./hrefs";

export interface CourseCardView {
  readonly course: CourseSummary;
  readonly href: string;
  readonly progressPercent: number | null;
}

export interface ResumeTarget {
  readonly label: "Start" | "Continue" | "Review";
  readonly lessonSlug: string;
}

export function coverUrl(coverKey: string | null): string | null {
  return coverKey ? uploadHref(coverKey) : null;
}

export function toCourseSummary(course: CourseRecordSummary): CourseSummary {
  return {
    slug: course.slug,
    title: course.title,
    description: course.description,
    coverUrl: coverUrl(course.coverKey),
    lessonCount: course.lessonCount,
    status: course.status,
    requiredLevel: course.requiredLevel,
    locked: course.locked,
  };
}

export function visibleCourses<T extends Pick<CourseRecordSummary, "status">>(
  courses: readonly T[],
  manager: boolean,
): T[] {
  return manager ? [...courses] : courses.filter((course) => course.status === "published");
}

export function toCourseCards(
  slug: string,
  courses: readonly CourseRecordSummary[],
  options: { manager: boolean; showProgress: boolean },
): CourseCardView[] {
  return visibleCourses(courses, options.manager).map((course) => ({
    course: toCourseSummary(course),
    href: courseHref(slug, course.slug),
    progressPercent:
      options.showProgress && course.publishedLessonCount > 0 ? course.progressPercent : null,
  }));
}

export function visibleModules(modules: readonly ModuleView[], manager: boolean): ModuleView[] {
  if (manager) return [...modules];
  return modules.map((module) => ({
    ...module,
    lessons: module.lessons.filter((lesson) => lesson.status === "published"),
  }));
}

export function toOutline(
  slug: string,
  courseSlug: string,
  modules: readonly ModuleView[],
): CourseOutlineModule[] {
  return modules.map((module) => ({
    id: module.id,
    title: module.title,
    lessons: module.lessons.map((lesson) => ({
      id: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      status: lesson.status,
      completed: lesson.completed,
      href: lessonHref(slug, courseSlug, lesson.slug),
    })),
  }));
}

export function toEditorModules(
  slug: string,
  courseSlug: string,
  modules: readonly ModuleView[],
): OutlineEditorModule[] {
  return modules.map((module) => ({
    id: module.id,
    title: module.title,
    lessons: module.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      status: lesson.status,
      href: lessonHref(slug, courseSlug, lesson.slug, { edit: true }),
    })),
  }));
}

export function resumeTarget(modules: readonly ModuleView[]): ResumeTarget | null {
  const published = modules
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.status === "published");
  const first = published[0];
  if (!first) return null;
  const next = published.find((lesson) => !lesson.completed);
  if (!next) return { label: "Review", lessonSlug: first.slug };
  const started = published.some((lesson) => lesson.completed);
  return { label: started ? "Continue" : "Start", lessonSlug: next.slug };
}

export interface LessonNeighbors {
  readonly previous: { readonly slug: string } | null;
  readonly next: { readonly slug: string } | null;
}

export function lessonNeighbors(modules: readonly ModuleView[], lessonId: string): LessonNeighbors {
  const lessons = modules.flatMap((module) => module.lessons);
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index === -1) return { previous: null, next: null };
  const previous = lessons[index - 1];
  const next = lessons[index + 1];
  return {
    previous: previous ? { slug: previous.slug } : null,
    next: next ? { slug: next.slug } : null,
  };
}

export function lessonProgress(
  outline: readonly CourseOutlineModule[],
  lessonId: string,
  tracksProgress: boolean,
): LessonPlayerProgress | null {
  const lessons = outline.flatMap((module) => module.lessons);
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index === -1) return null;
  const published = lessons.filter((lesson) => lesson.status !== "draft");
  const done = published.filter((lesson) => lesson.completed).length;
  return {
    position: index + 1,
    total: lessons.length,
    percent:
      tracksProgress && published.length > 0 ? Math.round((done / published.length) * 100) : null,
  };
}

export function courseFinished(outline: readonly CourseOutlineModule[]): boolean {
  const published = outline
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.status !== "draft");
  return published.length > 0 && published.every((lesson) => lesson.completed);
}

export function nextCourseAfter<
  T extends Pick<
    CourseRecordSummary,
    "slug" | "status" | "publishedLessonCount" | "progressPercent"
  >,
>(courses: readonly T[], currentSlug: string): T | null {
  const index = courses.findIndex((course) => course.slug === currentSlug);
  const ordered = [...courses.slice(index + 1), ...courses.slice(0, Math.max(index, 0))];
  return (
    ordered.find(
      (course) =>
        course.status === "published" &&
        course.publishedLessonCount > 0 &&
        course.progressPercent < 100,
    ) ?? null
  );
}

export interface NextLiveCall {
  readonly title: string;
  readonly when: string;
  readonly href: string;
}

export function nextLiveCall(
  occurrences: readonly EventOccurrence[],
  slug: string,
  timeZone: string,
): NextLiveCall | null {
  const next = occurrences.find((occurrence) => !occurrence.canceled);
  if (!next) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(next.startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    title: next.title,
    when: `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")} ${part("timeZoneName")}`,
    href: occurrenceHref(slug, next.eventSlug, next.id),
  };
}

export function toLessonAttachments(refs: readonly AttachmentRef[]): LessonAttachment[] {
  return refs.map((ref) => ({
    id: ref.key,
    name: ref.name,
    size: ref.size,
    contentType: ref.contentType,
    href: attachmentHref(ref.key),
  }));
}

export function toAttachmentRefs(attachments: readonly LessonAttachment[]): AttachmentRef[] {
  return attachments.flatMap((attachment) =>
    attachment.id
      ? [
          {
            key: attachment.id,
            name: attachment.name,
            size: attachment.size,
            contentType: attachment.contentType,
          },
        ]
      : [],
  );
}
