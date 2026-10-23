import { describe, expect, it } from "vitest";

import { nextFreeSlug, reservedSlugs, slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["  Héllo, Wörld!  ", "hello-world"],
    ["C++ & Rust: 101", "c-rust-101"],
    ["multiple   ---  dashes", "multiple-dashes"],
    ["日本語", ""],
  ])("turns %j into %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("caps the slug at 60 characters without a trailing hyphen", () => {
    const slug = slugify(`${"word ".repeat(30)}`);

    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("nextFreeSlug", () => {
  it("uses the base slug when it is free", () => {
    expect(nextFreeSlug("intro", "lesson", [])).toBe("intro");
  });

  it("adds the lowest free numeric suffix on collision", () => {
    expect(nextFreeSlug("intro", "lesson", ["intro", "intro-2", "intro-4"])).toBe("intro-3");
  });

  it("compares without regard to case", () => {
    expect(nextFreeSlug("intro", "lesson", ["INTRO"])).toBe("intro-2");
  });

  it("falls back to the kind when the title has no usable characters", () => {
    expect(nextFreeSlug("", "course", [])).toBe("course");
    expect(nextFreeSlug("", "course", ["course"])).toBe("course-2");
  });

  it.each([...reservedSlugs])("never returns the reserved word %s", (word) => {
    expect(nextFreeSlug(word, "course", [])).toBe(`${word}-2`);
  });
});
