"use client";

import { Progress } from "../primitives/progress";
import { cn } from "../lib/utils";
import { clampLevel, MAX_LEVEL } from "./types";

interface LevelProgressProps {
  level: number;
  points: number;
  nextLevelAt?: number | null;
  name?: string | null;
  locale?: string;
  className?: string;
}

function levelProgressLabel(
  level: number,
  points: number,
  nextLevelAt?: number | null,
  locale?: string,
): string {
  const current = clampLevel(level);
  if (current >= MAX_LEVEL || nextLevelAt === null || nextLevelAt === undefined) {
    return "Highest level";
  }
  const format = new Intl.NumberFormat(locale);
  return `${format.format(points)} of ${format.format(nextLevelAt)} points to Level ${current + 1}`;
}

function LevelProgress({
  level,
  points,
  nextLevelAt,
  name,
  locale,
  className,
}: LevelProgressProps) {
  const current = clampLevel(level);
  const label = levelProgressLabel(current, points, nextLevelAt, locale);
  const atTop = label === "Highest level";
  const max = atTop || !nextLevelAt || nextLevelAt <= 0 ? 1 : nextLevelAt;
  const value = atTop ? max : Math.min(Math.max(points, 0), max);

  return (
    <div data-slot="level-progress" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-text">
          Level {current}
          {name ? <span className="text-text-muted"> · {name}</span> : null}
        </span>
        <span className="text-text-muted tabular-nums">{label}</span>
      </div>
      <Progress value={value} max={max} aria-label={label} getValueLabel={() => label} />
    </div>
  );
}

export { LevelProgress, levelProgressLabel, type LevelProgressProps };
