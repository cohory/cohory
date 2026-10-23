import { leaderboardWindows, maxLevel } from "@cohory/gamification";
import { MAX_LEVEL } from "@cohory/ui";
import { describe, expect, it } from "vitest";

import {
  directoryHref,
  leaderboardWindowOptions,
  parseDirectoryParams,
  parseLeaderboardWindow,
} from "./params";
import { searchMembersActionSchema, updateBioActionSchema, usernameFormSchema } from "./schemas";

it("keeps the client side URL params in step with the gamification module", () => {
  expect(leaderboardWindowOptions).toEqual(leaderboardWindows);
  expect(MAX_LEVEL).toBe(maxLevel);
});

describe("directory URL params", () => {
  it("reads q and level from the search params", () => {
    expect(parseDirectoryParams({ q: "ada", level: "3" })).toEqual({ q: "ada", level: 3 });
  });

  it("defaults to an empty query and no level", () => {
    expect(parseDirectoryParams({})).toEqual({ q: "", level: null });
  });

  it("takes the first value when a param repeats", () => {
    expect(parseDirectoryParams({ q: ["ada", "bob"], level: ["2", "5"] })).toEqual({
      q: "ada",
      level: 2,
    });
  });

  it("ignores levels outside one to nine and non numbers", () => {
    expect(parseDirectoryParams({ level: "0" }).level).toBeNull();
    expect(parseDirectoryParams({ level: "10" }).level).toBeNull();
    expect(parseDirectoryParams({ level: "2.5" }).level).toBeNull();
    expect(parseDirectoryParams({ level: "high" }).level).toBeNull();
  });

  it("caps the query at 80 characters", () => {
    expect(parseDirectoryParams({ q: "a".repeat(200) }).q).toHaveLength(80);
  });

  it("builds a directory link without empty params", () => {
    expect(directoryHref("yoga", { q: "", level: null })).toBe("/c/yoga/members");
    expect(directoryHref("yoga", { q: "  ", level: 4 })).toBe("/c/yoga/members?level=4");
    expect(directoryHref("yoga", { q: "ada l", level: null })).toBe("/c/yoga/members?q=ada+l");
  });
});

describe("leaderboard window param", () => {
  it("defaults to 7 days", () => {
    expect(parseLeaderboardWindow({})).toBe("7d");
  });

  it("accepts 7d and all", () => {
    expect(parseLeaderboardWindow({ window: "7d" })).toBe("7d");
    expect(parseLeaderboardWindow({ window: "all" })).toBe("all");
  });

  it("falls back to 7 days for unknown values", () => {
    expect(parseLeaderboardWindow({ window: "30d" })).toBe("7d");
    expect(parseLeaderboardWindow({ window: ["all", "7d"] })).toBe("all");
  });
});

describe("server action input", () => {
  it("validates load more input", () => {
    const valid = { slug: "yoga", query: " ada ", level: null, cursor: "abc" };
    expect(searchMembersActionSchema.parse(valid).query).toBe("ada");
    expect(searchMembersActionSchema.safeParse({ ...valid, slug: "Bad Slug" }).success).toBe(false);
    expect(searchMembersActionSchema.safeParse({ ...valid, level: 12 }).success).toBe(false);
    expect(searchMembersActionSchema.safeParse({ ...valid, cursor: "" }).success).toBe(false);
  });

  it("trims the bio and rejects one over 500 characters", () => {
    expect(updateBioActionSchema.parse({ slug: "yoga", bio: "  hi  " }).bio).toBe("hi");
    const long = updateBioActionSchema.safeParse({ slug: "yoga", bio: "a".repeat(501) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe("Keep the bio under 500 characters.");
  });

  it("normalizes a username and strips a leading @", () => {
    expect(usernameFormSchema.parse({ username: " @Ada-L " }).username).toBe("ada-l");
  });

  it("explains what is wrong with an invalid username", () => {
    const message = (username: string) =>
      usernameFormSchema.safeParse({ username }).error?.issues[0]?.message;
    expect(message("")).toBe("Enter a username.");
    expect(message("ab")).toBe("Use at least 3 characters.");
    expect(message("ada--l")).toMatch(/single hyphens/);
    expect(message("a".repeat(31))).toBe("Use at most 30 characters.");
  });
});
