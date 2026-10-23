"use client";

import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Skeleton } from "../primitives/skeleton";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { CourseCover, CourseLevelBadge, CourseProgress, CourseStatusBadge } from "./course-parts";
import { lessonCountLabel, type CourseSummary } from "./types";

type CourseCardVariant = "grid" | "list";

interface CourseCardProps {
  course: CourseSummary;
  href: string;
  progressPercent?: number | null;
  actions?: ItemAction[];
  variant?: CourseCardVariant;
  locale?: string;
  className?: string;
}

function CourseCard({
  course,
  href,
  progressPercent,
  actions = [],
  variant = "grid",
  locale,
  className,
}: CourseCardProps) {
  const grid = variant === "grid";

  return (
    <article
      data-slot="course-card"
      data-variant={variant}
      className={cn(
        "relative flex overflow-hidden rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-bg hover:border-border-strong motion-reduce:transition-none",
        grid ? "flex-col" : "items-stretch",
        className,
      )}
    >
      <CourseCover
        title={course.title}
        coverUrl={course.coverUrl}
        className={grid ? undefined : "w-32 shrink-0 sm:w-48"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-base font-medium text-text">
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
            >
              {course.title}
            </Link>
          </h3>
          <CourseStatusBadge status={course.status} />
        </div>
        {course.description ? (
          <p className="line-clamp-2 text-sm text-text-muted">{course.description}</p>
        ) : null}
        <p className="text-sm text-text-muted">{lessonCountLabel(course.lessonCount, locale)}</p>
        <CourseLevelBadge requiredLevel={course.requiredLevel} locked={course.locked} />
        {typeof progressPercent === "number" && !course.locked ? (
          <CourseProgress percent={progressPercent} className="mt-auto pt-1" />
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className={cn(grid ? "absolute top-2 right-2" : "relative self-start p-1")}>
          <ItemActionsMenu
            actions={actions}
            label={`Actions for ${course.title}`}
            className={grid ? "bg-surface" : undefined}
          />
        </div>
      ) : null}
    </article>
  );
}

interface CourseCardSkeletonProps {
  variant?: CourseCardVariant;
  className?: string;
}

function CourseCardSkeleton({ variant = "grid", className }: CourseCardSkeletonProps) {
  const grid = variant === "grid";
  return (
    <div
      data-slot="course-card-skeleton"
      aria-hidden="true"
      className={cn(
        "flex overflow-hidden rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow)",
        grid ? "flex-col" : "items-stretch",
        className,
      )}
    >
      <Skeleton
        className={cn("aspect-video rounded-none", grid ? "w-full" : "w-32 shrink-0 sm:w-48")}
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-1 h-2 w-full" />
      </div>
    </div>
  );
}

export {
  CourseCard,
  CourseCardSkeleton,
  type CourseCardProps,
  type CourseCardSkeletonProps,
  type CourseCardVariant,
};
