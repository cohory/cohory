import { describe, expect, it } from "vitest";

import {
  defaultLevelNames,
  levelFor,
  levelName,
  levelThresholds,
  maxLevel,
  progressToNextLevel,
} from "./levels";

describe("levelFor", () => {
  it("has nine fixed thresholds starting at zero", () => {
    expect(levelThresholds).toEqual([0, 10, 30, 75, 150, 300, 600, 1200, 2500]);
    expect(maxLevel).toBe(9);
  });

  it.each([
    [0, 1],
    [9, 1],
    [10, 2],
    [29, 2],
    [30, 3],
    [74, 3],
    [75, 4],
    [150, 5],
    [300, 6],
    [600, 7],
    [1199, 7],
    [1200, 8],
    [2499, 8],
    [2500, 9],
    [1_000_000, 9],
  ])("puts %i points at level %i", (points, level) => {
    expect(levelFor(points)).toBe(level);
  });

  it("keeps negative totals at level 1", () => {
    expect(levelFor(-3)).toBe(1);
  });
});

describe("progressToNextLevel", () => {
  it("reports the points into the level and the points still needed", () => {
    expect(progressToNextLevel(20)).toEqual({
      level: 2,
      nextLevel: 3,
      currentThreshold: 10,
      nextThreshold: 30,
      pointsToNextLevel: 10,
      ratio: 0.5,
    });
  });

  it("starts at zero progress on a threshold", () => {
    expect(progressToNextLevel(75)).toMatchObject({ level: 4, pointsToNextLevel: 75, ratio: 0 });
  });

  it("reports full progress and no next level at the top", () => {
    expect(progressToNextLevel(9000)).toEqual({
      level: 9,
      nextLevel: null,
      currentThreshold: 2500,
      nextThreshold: null,
      pointsToNextLevel: null,
      ratio: 1,
    });
  });
});

describe("levelName", () => {
  it("uses the default names when the community has none", () => {
    expect(defaultLevelNames).toHaveLength(9);
    expect(levelName(1, null)).toBe("Level 1");
    expect(levelName(9, undefined)).toBe("Level 9");
  });

  it("uses the community names and falls back per level for blanks", () => {
    const names = ["Newcomer", "", "Regular"];

    expect(levelName(1, names)).toBe("Newcomer");
    expect(levelName(2, names)).toBe("Level 2");
    expect(levelName(4, names)).toBe("Level 4");
  });
});
