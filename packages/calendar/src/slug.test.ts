import { describe, expect, it } from "vitest";

import { nextFreeSlug, slugify } from "./slug";

describe("event slugs", () => {
  it("slugifies titles and strips accents", () => {
    expect(slugify("Café Friday: Q&A")).toBe("cafe-friday-q-a");
  });

  it("falls back to event and skips taken and reserved slugs", () => {
    expect(nextFreeSlug("", [])).toBe("event");
    expect(nextFreeSlug("weekly-call", ["weekly-call", "weekly-call-2"])).toBe("weekly-call-3");
    expect(nextFreeSlug("upcoming", [])).toBe("upcoming-2");
  });
});
