import { describe, expect, it } from "vitest";

import { previewGaps } from "./preview";

const filled = { hasCover: true, galleryCount: 3, hasDetailedDescription: true, reviewsOn: true };

describe("previewGaps", () => {
  it("lists nothing when the page has every part", () => {
    expect(previewGaps("makers", filled)).toEqual([]);
  });

  it("lists each missing part with a link to where the owner adds it", () => {
    expect(
      previewGaps("makers", {
        hasCover: false,
        galleryCount: 0,
        hasDetailedDescription: false,
        reviewsOn: false,
      }),
    ).toEqual([
      { label: "Cover image", href: "/c/makers/manage/appearance" },
      { label: "Gallery", href: "/c/makers/manage/appearance" },
      { label: "Detailed description", href: "/c/makers/manage/appearance" },
      { label: "Reviews", href: "/c/makers/manage/settings" },
    ]);
  });

  it("asks only for what is missing", () => {
    expect(previewGaps("makers", { ...filled, galleryCount: 0 })).toEqual([
      { label: "Gallery", href: "/c/makers/manage/appearance" },
    ]);
  });
});
