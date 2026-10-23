import { ForbiddenError, type Actor } from "@cohory/authz";
import { describe, expect, it, vi } from "vitest";

import { createSearchService, SearchValidationError, type SearchDeps } from "./service";

const actor: Actor = { kind: "user", userId: "u", platformAdmin: false };

function deps(overrides: Partial<SearchDeps> = {}) {
  return {
    posts: { searchPosts: vi.fn<SearchDeps["posts"]["searchPosts"]>().mockResolvedValue([]) },
    courses: {
      searchLessons: vi.fn<SearchDeps["courses"]["searchLessons"]>().mockResolvedValue([]),
    },
    members: { findMembers: vi.fn<SearchDeps["members"]["findMembers"]>().mockResolvedValue([]) },
    rateLimit: vi.fn<(key: string) => void>(),
    ...overrides,
  };
}

describe("search", () => {
  it("rate limits by the given key and asks every group with the trimmed query", async () => {
    const d = deps();

    const results = await createSearchService(d).search(actor, "c", { query: "  clay " }, "u");

    expect(results).toEqual({ query: "clay", posts: [], members: [], lessons: [] });
    expect(d.rateLimit).toHaveBeenCalledWith("u");
    expect(d.posts.searchPosts).toHaveBeenCalledWith(actor, "c", "clay", 10, { comments: true });
    expect(d.members.findMembers).toHaveBeenCalledWith(actor, "c", "clay", 10);
    expect(d.courses.searchLessons).toHaveBeenCalledWith(actor, "c", "clay", 10);
  });

  it.each(["a", " ", "x".repeat(101), "!!"])("refuses the query %j", async (query) => {
    const d = deps();

    await expect(createSearchService(d).search(actor, "c", { query }, "u")).rejects.toBeInstanceOf(
      SearchValidationError,
    );
    expect(d.rateLimit).not.toHaveBeenCalled();
  });

  it("leaves out groups the actor may not see and keeps the rest", async () => {
    const d = deps({
      members: {
        findMembers: vi.fn().mockRejectedValue(new ForbiddenError("list", "membership")),
      },
      courses: { searchLessons: vi.fn().mockRejectedValue(new ForbiddenError("read", "lesson")) },
    });

    const results = await createSearchService(d).search(actor, "c", { query: "clay" }, "u");

    expect(results.members).toEqual([]);
    expect(results.lessons).toEqual([]);
  });

  it("asks only the groups the caller's scopes cover", async () => {
    const d = deps();

    await createSearchService(d).search(
      actor,
      "c",
      { query: "clay" },
      "u",
      (scope) => scope === "posts:read",
    );

    expect(d.posts.searchPosts).toHaveBeenCalledWith(actor, "c", "clay", 10, { comments: false });
    expect(d.members.findMembers).not.toHaveBeenCalled();
    expect(d.courses.searchLessons).not.toHaveBeenCalled();
  });

  it("refuses the whole search when posts are not readable", async () => {
    const d = deps({
      posts: { searchPosts: vi.fn().mockRejectedValue(new ForbiddenError("read", "post")) },
    });

    await expect(
      createSearchService(d).search(actor, "c", { query: "clay" }, "u"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
