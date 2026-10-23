"use client";

import { LockIcon } from "lucide-react";

import { Badge } from "../primitives/badge";
import { Progress } from "../primitives/progress";
import { cn } from "../lib/utils";
import { safeImageSrc } from "../community/content";
import { normalizePercent, progressLabel, type CourseStatus } from "./types";

interface CourseCoverProps {
  title: string;
  coverUrl?: string | null;
  className?: string;
}

function CourseCover({ title, coverUrl, className }: CourseCoverProps) {
  const src = coverUrl ? safeImageSrc(coverUrl) : null;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("aspect-video w-full bg-surface-hover object-cover", className)}
      />
    );
  }
  const letter = title.trim().charAt(0).toUpperCase() || "C";
  return (
    <div
      aria-hidden="true"
      data-slot="course-cover-placeholder"
      className={cn(
        "flex aspect-video w-full items-center justify-center bg-accent-muted font-heading text-3xl font-semibold text-accent",
        className,
      )}
    >
      {letter}
    </div>
  );
}

interface CourseProgressProps {
  percent: number;
  className?: string;
}

function CourseProgress({ percent, className }: CourseProgressProps) {
  const value = normalizePercent(percent);
  const label = progressLabel(value);
  return (
    <div data-slot="course-progress" className={cn("flex items-center gap-3", className)}>
      <Progress
        value={value}
        aria-label="Course progress"
        getValueLabel={() => label}
        className="flex-1"
      />
      <span className="shrink-0 text-sm text-text-muted tabular-nums">{label}</span>
    </div>
  );
}

function CourseStatusBadge({ status }: { status?: CourseStatus }) {
  if (status === "draft") return <Badge variant="warning">Draft</Badge>;
  if (status === "archived") return <Badge variant="neutral">Archived</Badge>;
  return null;
}

function CourseLevelBadge({
  requiredLevel,
  locked,
}: {
  requiredLevel?: number | null;
  locked?: boolean;
}) {
  if (!requiredLevel) return null;
  if (!locked) {
    return <Badge variant="neutral" className="w-fit">{`Level ${requiredLevel} and up`}</Badge>;
  }
  return (
    <Badge variant="neutral" className="w-fit gap-1">
      <LockIcon aria-hidden="true" className="size-3" />
      {`Unlocks at Level ${requiredLevel}`}
    </Badge>
  );
}

export { CourseCover, CourseLevelBadge, CourseProgress, CourseStatusBadge };
