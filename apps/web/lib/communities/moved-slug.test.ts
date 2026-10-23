import { describe, expect, it, vi } from "vitest";

import { communityPathSlug, movedCommunityLocation } from "./moved-slug";

describe("communityPathSlug", () => {
  it.each([
    ["/c/old", "old"],
    ["/c/old/", "old"],
    ["/c/old/about", "old"],
    ["/c/old/classroom/intro/lesson-1", "old"],
  ])("finds the slug in %s", (path, slug) => {
    expect(communityPathSlug(path)).toBe(slug);
  });

  it.each(["/", "/c", "/c/", "/communities/new", "/join/token", "/cx/old"])(
    "ignores %s",
    (path) => {
      expect(communityPathSlug(path)).toBeNull();
    },
  );
});

describe("movedCommunityLocation", () => {
  const lookup = vi.fn(async (slug: string) => (slug === "old" ? "new" : null));

  it("keeps the rest of the path and the query string", async () => {
    expect(
      await movedCommunityLocation(new URL("http://app.test/c/old/about?tab=reviews#x"), lookup),
    ).toBe("/c/new/about?tab=reviews");
  });

  it("redirects the community root", async () => {
    expect(await movedCommunityLocation(new URL("http://app.test/c/old"), lookup)).toBe("/c/new");
  });

  it("answers null for a current or unknown slug without guessing", async () => {
    expect(await movedCommunityLocation(new URL("http://app.test/c/new/feed"), lookup)).toBeNull();
    expect(await movedCommunityLocation(new URL("http://app.test/account"), lookup)).toBeNull();
  });
});
