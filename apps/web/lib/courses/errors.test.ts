import { CoursesValidationError, maxTitleLength } from "@cohory/courses";
import { describe, expect, it } from "vitest";

import { courseActionFailure } from "./errors";
import { updateLessonSchema } from "./schemas";

describe("courseActionFailure", () => {
  it("puts a service validation message on the field it belongs to", () => {
    const failure = courseActionFailure(
      new CoursesValidationError([
        { path: "videoUrl", message: "Use a YouTube, Vimeo, Loom, or Wistia link." },
      ]),
    );

    expect(failure).toEqual({
      ok: false,
      message: "Use a YouTube, Vimeo, Loom, or Wistia link.",
      fieldErrors: { videoUrl: "Use a YouTube, Vimeo, Loom, or Wistia link." },
    });
  });

  it("puts a form validation message on the field it belongs to", () => {
    const parsed = updateLessonSchema.safeParse({
      slug: "design",
      courseSlug: "basics",
      lessonId: "0192d3c0-0000-7000-8000-000000000001",
      title: "a".repeat(maxTitleLength + 1),
      bodyMarkdown: "",
      videoUrl: "",
      attachments: [],
    });
    if (parsed.success) throw new Error("expected the long title to fail");

    expect(courseActionFailure(parsed.error)).toEqual({
      ok: false,
      message: "Use 120 characters or fewer for the title.",
      fieldErrors: { title: "Use 120 characters or fewer for the title." },
    });
  });

  it("keeps the first message for each field", () => {
    const failure = courseActionFailure(
      new CoursesValidationError([
        { path: "title", message: "Add a title." },
        { path: "title", message: "Second problem." },
      ]),
    );

    expect(failure).toMatchObject({ fieldErrors: { title: "Add a title." } });
  });
});
