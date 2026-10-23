"use client";

import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import { CourseCover, CourseProgress, CourseStatusBadge } from "./course-parts";
import { lessonCountLabel, type CourseSummary } from "./types";

type CourseHeaderPrimaryAction =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick(): void; href?: never };

interface CourseHeaderProps {
  course: CourseSummary;
  progressPercent?: number | null;
  actions?: ItemAction[];
  primaryAction?: CourseHeaderPrimaryAction;
  locale?: string;
  className?: string;
}

function CourseHeader({
  course,
  progressPercent,
  actions = [],
  primaryAction,
  locale,
  className,
}: CourseHeaderProps) {
  return (
    <header
      data-slot="course-header"
      className={cn(
        "flex flex-col gap-6 overflow-hidden rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) md:flex-row",
        className,
      )}
    >
      <CourseCover
        title={course.title}
        coverUrl={course.coverUrl}
        className={cn(
          "md:w-80 md:shrink-0",
          !course.coverUrl && "aspect-auto h-20 text-2xl md:aspect-video md:h-auto md:text-3xl",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 md:py-6 md:pr-6 md:pl-0">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 font-heading text-2xl text-text">{course.title}</h1>
          <CourseStatusBadge status={course.status} />
          <ItemActionsMenu actions={actions} label={`Actions for ${course.title}`} />
        </div>
        {course.description ? (
          <p className="text-base text-text-muted">{course.description}</p>
        ) : null}
        <p className="text-sm text-text-muted">{lessonCountLabel(course.lessonCount, locale)}</p>
        {typeof progressPercent === "number" ? (
          <CourseProgress percent={progressPercent} className="max-w-md" />
        ) : null}
        {primaryAction ? (
          <div className="mt-2">
            {primaryAction.href !== undefined ? (
              <Button asChild>
                <a href={primaryAction.href}>{primaryAction.label}</a>
              </Button>
            ) : (
              <Button type="button" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export { CourseHeader, type CourseHeaderPrimaryAction, type CourseHeaderProps };
