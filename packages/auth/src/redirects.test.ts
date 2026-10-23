import { describe, expect, it } from "vitest";

import { isDeletionPending, safeRedirectPath, signInPath, verifiedPath } from "./redirects";

describe("safeRedirectPath", () => {
  it.each([
    ["/c/yoga", "/c/yoga"],
    ["/c/yoga/classroom/intro?tab=1#top", "/c/yoga/classroom/intro?tab=1#top"],
    ["/", "/"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["c/yoga"],
    [""],
    [undefined],
    [["/a", "/b"]],
  ])("falls back to / for %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it.each([["/.//x"], ["/..//x"], ["/%2e//x"], ["/a/..//x"], ["/./\\x"], ["/%2E%2E//x?y=1"]])(
    "falls back to / when %j normalizes to a protocol relative path",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );

  it("still resolves harmless dot segments inside the site", () => {
    expect(safeRedirectPath("/c/yoga/../makers")).toBe("/c/makers");
  });
});

describe("signInPath", () => {
  it("returns the plain sign in path without a return path", () => {
    expect(signInPath()).toBe("/sign-in");
    expect(signInPath("/")).toBe("/sign-in");
  });

  it("encodes a safe return path in ?next=", () => {
    expect(signInPath("/c/yoga/members?x=1")).toBe("/sign-in?next=%2Fc%2Fyoga%2Fmembers%3Fx%3D1");
  });

  it("drops an unsafe return path", () => {
    expect(signInPath("//evil.example")).toBe("/sign-in");
  });
});

describe("verifiedPath", () => {
  it("sends confirmation links to /verified and keeps where the person was going", () => {
    expect(verifiedPath("/c/yoga/about")).toBe("/verified?next=%2Fc%2Fyoga%2Fabout");
    expect(verifiedPath("/")).toBe("/verified");
    expect(verifiedPath(undefined)).toBe("/verified");
  });

  it("does not wrap a path that already points at /verified", () => {
    expect(verifiedPath("/verified?next=%2Fc%2Fyoga")).toBe("/verified?next=%2Fc%2Fyoga");
  });

  it("drops an unsafe return path", () => {
    expect(verifiedPath("https://evil.example")).toBe("/verified");
  });
});

describe("isDeletionPending", () => {
  it("is true only when a deletion date is set", () => {
    expect(isDeletionPending({ deletionScheduledFor: new Date() })).toBe(true);
    expect(isDeletionPending({ deletionScheduledFor: null })).toBe(false);
    expect(isDeletionPending({})).toBe(false);
  });
});
