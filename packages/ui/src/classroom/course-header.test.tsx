import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseHeader } from "./course-header";

const course = { slug: "basics", title: "Basics", description: null, lessonCount: 3 };

describe("CourseHeader", () => {
  it("keeps the letter placeholder short on phones when there is no cover", () => {
    const { container } = render(<CourseHeader course={{ ...course, coverUrl: null }} />);

    const placeholder = container.querySelector("[data-slot='course-cover-placeholder']");
    expect(placeholder?.className).toContain("h-20");
    expect(placeholder?.className).toContain("md:aspect-video");
  });
});
