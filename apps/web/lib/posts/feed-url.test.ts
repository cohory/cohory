import { describe, expect, it } from "vitest";

import { feedHref, parseFeedSearchParams } from "./feed-url";

describe("feed URL state", () => {
  it("reads a valid category slug and sort and ignores anything else", () => {
    expect(parseFeedSearchParams({ category: "general", sort: "top" })).toEqual({
      category: "general",
      sort: "top",
    });
    expect(parseFeedSearchParams({ category: ["intros", "x"], sort: "new" })).toEqual({
      category: "intros",
      sort: "new",
    });
    expect(parseFeedSearchParams({ category: "Not Valid!", sort: "random" })).toEqual({
      category: null,
      sort: "active",
    });
    expect(parseFeedSearchParams({})).toEqual({ category: null, sort: "active" });
  });

  it("builds the feed link with only the state that differs from the default", () => {
    expect(feedHref("makers", { category: null, sort: "active" })).toBe("/c/makers");
    expect(feedHref("makers", { category: "general", sort: "active" })).toBe(
      "/c/makers?category=general",
    );
    expect(feedHref("makers", { category: "general", sort: "top" })).toBe(
      "/c/makers?category=general&sort=top",
    );
  });
});
