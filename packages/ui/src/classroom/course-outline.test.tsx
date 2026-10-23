import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseOutline } from "./course-outline";
import { outline } from "./fixtures.test-utils";

describe("CourseOutline", () => {
  it("highlights the current lesson and marks completion and drafts", () => {
    render(<CourseOutline modules={outline()} currentLessonId="l2" />);

    const current = screen.getByRole("link", { name: "Setup" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("bg-accent-muted");
    expect(screen.getByRole("link", { name: /Welcome/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Welcome, completed" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Habits, Draft" }).textContent).toContain("Draft");
    expect(
      screen.getByRole("button", { name: "Getting started, 1 of 2 lessons completed" }),
    ).toBeTruthy();
  });

  it("moves focus between lessons with arrow keys, Home, and End", () => {
    render(<CourseOutline modules={outline()} />);
    const welcome = screen.getByRole("link", { name: /Welcome/ });
    welcome.focus();

    fireEvent.keyDown(welcome, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Setup");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Habits");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(welcome);
    fireEvent.keyDown(welcome, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Habits");
  });

  it("collapses modules through their header", () => {
    render(<CourseOutline modules={outline()} />);
    const trigger = screen.getByRole("button", { name: /Getting started/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Setup" })).toBeNull();
  });

  it("renders static headers when not collapsible", () => {
    render(<CourseOutline modules={outline()} collapsible={false} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: /Going further/ })).toBeTruthy();
  });
});
