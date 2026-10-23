import { describe, expect, it } from "vitest";

import { progressPercent } from "./progress";

describe("progressPercent", () => {
  it.each([
    [0, 0, 0],
    [0, 4, 0],
    [1, 4, 25],
    [1, 3, 33],
    [2, 3, 67],
    [4, 4, 100],
    [5, 4, 100],
  ])("is %i of %i lessons as %i percent", (completed, total, percent) => {
    expect(progressPercent(completed, total)).toBe(percent);
  });
});
