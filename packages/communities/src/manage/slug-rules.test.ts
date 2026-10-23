import { describe, expect, it } from "vitest";

import { CommunityValidationError, SlugReservedError } from "../errors";
import {
  nextSlugChangeAt,
  parseNewSlug,
  slugChangeAllowed,
  slugChangeIntervalDays,
} from "./slug-rules";

const changedAt = new Date("2026-10-01T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

describe("parseNewSlug", () => {
  it("accepts a lowercase slug with single hyphens", () => {
    expect(parseNewSlug("makers-guild")).toBe("makers-guild");
  });

  it("trims surrounding spaces before checking", () => {
    expect(parseNewSlug("  makers-guild ")).toBe("makers-guild");
  });

  it.each(["ab", "Makers", "makers--guild", "-makers", "makers_guild", "a".repeat(49)])(
    "rejects %s with a validation error",
    (slug) => {
      expect(() => parseNewSlug(slug)).toThrow(CommunityValidationError);
    },
  );

  it.each(["manage", "api", "settings", "www"])("rejects the reserved slug %s", (slug) => {
    expect(() => parseNewSlug(slug)).toThrow(SlugReservedError);
  });
});

describe("the 30 day limit", () => {
  it("allows the first change at any time", () => {
    expect(nextSlugChangeAt(null)).toBeNull();
    expect(slugChangeAllowed(null, changedAt)).toBe(true);
  });

  it("allows the next change exactly 30 days after the last one", () => {
    expect(slugChangeIntervalDays).toBe(30);
    const next = new Date(changedAt.getTime() + 30 * dayMs);
    expect(nextSlugChangeAt(changedAt)).toEqual(next);
    expect(slugChangeAllowed(changedAt, next)).toBe(true);
  });

  it("refuses a change one millisecond before the 30 days are over", () => {
    const almost = new Date(changedAt.getTime() + 30 * dayMs - 1);
    expect(slugChangeAllowed(changedAt, almost)).toBe(false);
  });
});
