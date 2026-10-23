import { describe, expect, it } from "vitest";

import { bumpSemver, compareSemver, formatSemver, nextVersions, parseSemver } from "./semver";

describe("agent material versions", () => {
  it("starts at 1.0.0 whatever the bump", () => {
    expect(formatSemver(bumpSemver(null, "patch"))).toBe("1.0.0");
    expect(formatSemver(bumpSemver(null, "major"))).toBe("1.0.0");
  });

  it("bumps patch, minor, and major and resets lower parts", () => {
    const latest = parseSemver("1.4.2");
    expect(nextVersions(latest)).toEqual({ patch: "1.4.3", minor: "1.5.0", major: "2.0.0" });
  });

  it("parses only plain semantic versions", () => {
    expect(parseSemver("1.0")).toBeNull();
    expect(parseSemver("01.0.0")).toBeNull();
    expect(parseSemver("1.0.0-beta")).toBeNull();
    expect(parseSemver("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("compares numerically", () => {
    const a = parseSemver("1.10.0");
    const b = parseSemver("1.9.9");
    if (!a || !b) throw new Error("parse");
    expect(compareSemver(a, b)).toBeGreaterThan(0);
  });
});
