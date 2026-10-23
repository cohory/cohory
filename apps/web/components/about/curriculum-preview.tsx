import { lessonCountLabel } from "@cohory/ui";
import { BookOpen, Lock } from "lucide-react";

import type { CoursePreviewView } from "../../lib/communities/about";
import { aboutCard } from "./about-blocks";
import { StoredImage } from "../stored-image";

export function CourseList({ courses }: { courses: readonly CoursePreviewView[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {courses.map((course, index) => (
        <li key={`${index}:${course.title}`} className="flex items-center gap-3 text-left">
          <span className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent-muted text-accent">
            {course.coverUrl ? (
              <StoredImage
                src={course.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <BookOpen aria-hidden="true" className="size-5" strokeWidth={1.5} />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-base font-medium break-words text-text">{course.title}</span>
            <span className="inline-flex items-center gap-1 text-sm text-text-muted">
              <Lock aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              {lessonCountLabel(course.lessonCount)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CurriculumPreview({ courses }: { courses: readonly CoursePreviewView[] }) {
  if (courses.length === 0) {
    return null;
  }
  return (
    <section id="courses" aria-labelledby="courses-heading" className={`${aboutCard} scroll-mt-20`}>
      <h3 id="courses-heading" className="mb-1 text-xl text-text">
        Courses
      </h3>
      <p className="mb-4 text-sm text-text-muted">Lessons open when you join.</p>
      <CourseList courses={courses} />
    </section>
  );
}
