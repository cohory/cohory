import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CurriculumPreview } from "./curriculum-preview";

describe("CurriculumPreview", () => {
  it("lists course titles with their lesson counts and covers, lessons locked", () => {
    render(
      <CurriculumPreview
        courses={[
          { title: "Glazing", coverUrl: "/api/uploads/cover.png", lessonCount: 12 },
          { title: "Firing", coverUrl: null, lessonCount: 1 },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Courses" });
    const items = within(region).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Glazing"),
      expect.stringContaining("Firing"),
    ]);
    expect(within(items[0] ?? region).getByText("12 lessons")).toBeTruthy();
    expect(within(items[1] ?? region).getByText("1 lesson")).toBeTruthy();
    expect(items[0]?.querySelector("img")?.getAttribute("src")).toBe("/api/uploads/cover.png");
    expect(within(region).getByText("Lessons open when you join.")).toBeTruthy();
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders nothing without published courses", () => {
    const { container } = render(<CurriculumPreview courses={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
