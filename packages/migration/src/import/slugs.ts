import { nextFreeSlug as nextEventSlug, slugify as slugifyEvent } from "@cohory/calendar/slug";
import { nextFreeSlug as nextCourseSlug, slugify } from "@cohory/courses";

import type { ArchiveRecords } from "../format/records";

export type SlugEntity = "course" | "lesson" | "event";

export interface SlugRename {
  readonly entity: SlugEntity;
  readonly from: string;
  readonly to: string;
}

export interface ImportSlugs {
  course(sourceId: string): string | undefined;
  lesson(sourceId: string): string | undefined;
  event(sourceId: string): string | undefined;
  readonly renamed: readonly SlugRename[];
}

interface SluggedRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

type NextSlug = (base: string, taken: readonly string[]) => string;

function assignGroup(
  entity: SlugEntity,
  rows: readonly SluggedRow[],
  normalize: (value: string) => string,
  next: NextSlug,
  target: Map<string, string>,
  renamed: SlugRename[],
): void {
  const taken: string[] = [];
  const later: SluggedRow[] = [];
  for (const row of rows) {
    if (row.slug === normalize(row.slug) && next(row.slug, taken) === row.slug) {
      taken.push(row.slug);
      target.set(row.id, row.slug);
    } else {
      later.push(row);
    }
  }
  for (const row of later) {
    const slug = next(normalize(row.slug) || normalize(row.title), taken);
    taken.push(slug);
    target.set(row.id, slug);
    renamed.push({ entity, from: row.slug, to: slug });
  }
}

export function planImportSlugs(
  records: Pick<ArchiveRecords, "courses" | "lessons" | "events">,
): ImportSlugs {
  const renamed: SlugRename[] = [];
  const courses = new Map<string, string>();
  assignGroup(
    "course",
    records.courses,
    slugify,
    (base, taken) => nextCourseSlug(base, "course", taken),
    courses,
    renamed,
  );

  const lessons = new Map<string, string>();
  const byCourse = new Map<string, SluggedRow[]>();
  for (const row of records.lessons) {
    const group = byCourse.get(row.courseId) ?? [];
    group.push(row);
    byCourse.set(row.courseId, group);
  }
  for (const group of byCourse.values()) {
    assignGroup(
      "lesson",
      group,
      slugify,
      (base, taken) => nextCourseSlug(base, "lesson", taken),
      lessons,
      renamed,
    );
  }

  const events = new Map<string, string>();
  assignGroup("event", records.events, slugifyEvent, nextEventSlug, events, renamed);

  return {
    course: (id) => courses.get(id),
    lesson: (id) => lessons.get(id),
    event: (id) => events.get(id),
    renamed,
  };
}
