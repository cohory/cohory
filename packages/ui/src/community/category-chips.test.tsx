import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CategoryChips } from "./category-chips";

describe("CategoryChips", () => {
  it("renders links and marks the active chip as the current page", () => {
    render(
      <CategoryChips
        chips={[
          { key: "all", label: "All", href: "/c/demo", active: false },
          {
            key: "general",
            label: "General",
            href: "/c/demo?category=general",
            active: true,
            color: "accent",
          },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Filter by category" });
    expect(nav).toBeTruthy();
    expect(screen.getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBeNull();
  });
});
