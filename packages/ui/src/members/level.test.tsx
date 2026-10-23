import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LevelBadge } from "./level-badge";
import { LevelProgress, levelProgressLabel } from "./level-progress";

describe("LevelBadge", () => {
  it("shows the level number with an accessible name", () => {
    render(<LevelBadge level={4} />);

    const badge = screen.getByRole("img", { name: "Level 4" });
    expect(badge.textContent).toBe("4");
    expect(badge.hasAttribute("tabindex")).toBe(false);
  });

  it("includes the level name and becomes focusable for its tooltip", () => {
    render(<LevelBadge level={2} name="Builder" size="md" />);

    const badge = screen.getByRole("img", { name: "Level 2, Builder" });
    expect(badge.textContent).toBe("Level 2");
    expect(badge.getAttribute("tabindex")).toBe("0");
  });

  it("clamps levels to 1 through 9", () => {
    render(
      <>
        <LevelBadge level={0} />
        <LevelBadge level={12} />
      </>,
    );

    expect(screen.getByRole("img", { name: "Level 1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Level 9" })).toBeTruthy();
  });

  it("renders nothing when gamification is turned off", () => {
    const { container } = render(<LevelBadge level={5} name="Expert" disabled />);

    expect(container.innerHTML).toBe("");
  });
});

describe("LevelProgress", () => {
  it("labels progress toward the next level", () => {
    render(<LevelProgress level={3} points={120} nextLevelAt={200} />);

    const bar = screen.getByRole("progressbar", { name: "120 of 200 points to Level 4" });
    expect(bar.getAttribute("aria-valuetext")).toBe("120 of 200 points to Level 4");
    expect(bar.getAttribute("aria-valuemax")).toBe("200");
    expect(bar.getAttribute("aria-valuenow")).toBe("120");
  });

  it("shows Highest level at level 9", () => {
    render(<LevelProgress level={9} points={9000} nextLevelAt={null} name="Legend" />);

    expect(screen.getByRole("progressbar", { name: "Highest level" })).toBeTruthy();
    expect(screen.getByText("Highest level")).toBeTruthy();
    expect(levelProgressLabel(9, 9000, 12000)).toBe("Highest level");
  });
});
