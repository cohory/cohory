import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewBanner } from "./preview-banner";

describe("PreviewBanner", () => {
  it("coaches the owner with a link for each missing part", () => {
    render(
      <PreviewBanner
        slug="makers"
        gaps={[
          { label: "Cover image", href: "/c/makers/manage/appearance" },
          { label: "Reviews", href: "/c/makers/manage/settings" },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "Missing from this page" });
    expect(list.textContent).toContain("Cover image");
    expect(screen.getByRole("link", { name: "Reviews" }).getAttribute("href")).toBe(
      "/c/makers/manage/settings",
    );
  });

  it("shows no list when nothing is missing", () => {
    render(<PreviewBanner slug="makers" gaps={[]} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Appearance" })).toBeTruthy();
  });
});
