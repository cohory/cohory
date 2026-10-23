import { describe, expect, it } from "vitest";

import { prefixTsQuery, searchTerms, splitHighlights } from "./search";

describe("search query building", () => {
  it("keeps letters and digits only and turns each term into a prefix match", () => {
    expect(prefixTsQuery("  Pottery & 'glaze':* | !kiln ")).toBe("pottery:* & glaze:* & kiln:*");
    expect(prefixTsQuery("Ünïcode café 2026")).toBe("ünïcode:* & café:* & 2026:*");
  });

  it("returns nothing for input without a term and caps the number of terms", () => {
    expect(prefixTsQuery(" ':*&| ")).toBeNull();
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("same Same SAME")).toEqual(["same"]);
  });
});

describe("splitHighlights", () => {
  it("splits a headline into plain and matched segments", () => {
    expect(splitHighlights("Learn \u0002pottery\u0003 at home")).toEqual([
      { text: "Learn ", match: false },
      { text: "pottery", match: true },
      { text: " at home", match: false },
    ]);
    expect(splitHighlights("no match")).toEqual([{ text: "no match", match: false }]);
  });
});
