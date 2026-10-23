import { describe, expect, it } from "vitest";

import { fitsMemberCapacity } from "./capacity";

const limits = { members: 10, storageBytes: null, uploadBytes: null };

describe("fitsMemberCapacity", () => {
  it("says whether the members fit the limit", () => {
    expect(fitsMemberCapacity(limits, 9)).toBe(true);
    expect(fitsMemberCapacity(limits, 10)).toBe(false);
    expect(fitsMemberCapacity({ ...limits, members: null }, 100_000)).toBe(true);
  });

  it("lets an error other than the member limit reach the caller", () => {
    const broken = () => {
      throw new TypeError("limits are not loaded");
    };

    expect(() => fitsMemberCapacity(limits, 1, broken)).toThrow(TypeError);
  });
});
