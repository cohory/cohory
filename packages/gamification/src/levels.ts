import { defaultLevelNames } from "@cohory/db/schema";

import type { LadderStep } from "./views";

export { defaultLevelNames };

export const levelThresholds = [0, 10, 30, 75, 150, 300, 600, 1200, 2500] as const;

export const maxLevel = levelThresholds.length;

export interface LevelProgress {
  readonly level: number;
  readonly nextLevel: number | null;
  readonly currentThreshold: number;
  readonly nextThreshold: number | null;
  readonly pointsToNextLevel: number | null;
  readonly ratio: number;
}

export function levelFor(points: number): number {
  let level = 1;
  levelThresholds.forEach((threshold, index) => {
    if (points >= threshold) {
      level = index + 1;
    }
  });
  return level;
}

export function progressToNextLevel(points: number): LevelProgress {
  const level = levelFor(points);
  const currentThreshold = levelThresholds[level - 1] ?? 0;
  const nextThreshold = levelThresholds[level] ?? null;
  if (nextThreshold === null) {
    return {
      level,
      nextLevel: null,
      currentThreshold,
      nextThreshold: null,
      pointsToNextLevel: null,
      ratio: 1,
    };
  }
  const earned = Math.max(points, 0) - currentThreshold;
  return {
    level,
    nextLevel: level + 1,
    currentThreshold,
    nextThreshold,
    pointsToNextLevel: nextThreshold - Math.max(points, 0),
    ratio: earned / (nextThreshold - currentThreshold),
  };
}

export function ladderOf(
  names: readonly string[] | null | undefined,
  membersAt: ReadonlyMap<number, number>,
): LadderStep[] {
  const total = [...membersAt.values()].reduce((sum, count) => sum + count, 0);
  return levelThresholds.map((minPoints, index) => {
    const level = index + 1;
    const members = membersAt.get(level) ?? 0;
    return {
      level,
      name: levelName(level, names),
      minPoints,
      members,
      share: total === 0 ? 0 : Math.round((members * 100) / total),
    };
  });
}

export function levelName(level: number, names: readonly string[] | null | undefined): string {
  const custom = names?.[level - 1]?.trim();
  return custom || (defaultLevelNames[level - 1] ?? `Level ${level}`);
}
