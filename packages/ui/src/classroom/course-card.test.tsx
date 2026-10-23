import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseCard, CourseCardSkeleton } from "./course-card";
import { CourseHeader } from "./course-header";
import { course } from "./fixtures.test-utils";

describe("CourseCard", () => {
  it("tells a member below the required level when the course unlocks", () => {
    render(
      <CourseCard
        course={course({ requiredLevel: 3, locked: true })}
        href="/c"
        progressPercent={0}
      />,
    );

    expect(screen.getByText("Unlocks at Level 3")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("names the required level on a course the viewer can open", () => {
    render(<CourseCard course={course({ requiredLevel: 3, locked: false })} href="/c" />);

    expect(screen.getByText("Level 3 and up")).toBeTruthy();
  });

  it("renders title link, description, lesson count, and a letter placeholder cover", () => {
    const { container } = render(
      <CourseCard course={course()} href="/c/demo/classroom/foundations" />,
    );

    expect(screen.getByRole("link", { name: "Foundations" }).getAttribute("href")).toBe(
      "/c/demo/classroom/foundations",
    );
    expect(screen.getByText("Everything you need to start.").className).toContain("line-clamp-2");
    expect(screen.getByText("12 lessons")).toBeTruthy();
    expect(container.querySelector("[data-slot='course-cover-placeholder']")?.textContent).toBe(
      "F",
    );
  });

  it("shows a labelled progress bar only when progress is a number", () => {
    const { rerender } = render(<CourseCard course={course()} href="/c" progressPercent={40} />);

    const bar = screen.getByRole("progressbar", { name: "Course progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuetext")).toBe("40% complete");
    expect(screen.getByText("40% complete")).toBeTruthy();

    rerender(<CourseCard course={course()} href="/c" progressPercent={100} />);
    expect(screen.getByText("Completed")).toBeTruthy();

    rerender(<CourseCard course={course()} href="/c" progressPercent={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("marks drafts and renders overflow actions", () => {
    render(
      <CourseCard
        course={course({ status: "draft" })}
        href="/c"
        actions={[{ id: "edit", label: "Edit course", onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for Foundations" })).toBeTruthy();
  });

  it("renders a list variant and a skeleton", () => {
    const { container } = render(
      <>
        <CourseCard
          course={course({ coverUrl: "https://cdn.example.com/c.png" })}
          href="/c"
          variant="list"
        />
        <CourseCardSkeleton variant="list" />
      </>,
    );

    expect(container.querySelector("[data-variant='list'] img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/c.png",
    );
    expect(container.querySelector("[data-slot='course-card-skeleton']")).toBeTruthy();
  });
});

describe("CourseHeader", () => {
  it("renders title, description, progress, and a link primary action", () => {
    render(
      <CourseHeader
        course={course()}
        progressPercent={50}
        primaryAction={{ label: "Continue", href: "/c/demo/classroom/foundations/setup" }}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Foundations" })).toBeTruthy();
    expect(screen.getByText("50% complete")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
      "/c/demo/classroom/foundations/setup",
    );
  });

  it("renders a button primary action", () => {
    const onClick = vi.fn();
    render(<CourseHeader course={course()} primaryAction={{ label: "Start", onClick }} />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
