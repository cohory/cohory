import { describe, expect, it } from "vitest";

import {
  createCourseSchema,
  recordViewSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  setLessonCompleteSchema,
  updateLessonSchema,
} from "./schemas";

const lessonId = "0192f2a4-0000-7000-8000-000000000020";
const moduleId = "0192f2a4-0000-7000-8000-000000000030";

describe("course action schemas", () => {
  it("accepts a new course and trims the title", () => {
    const parsed = createCourseSchema.parse({
      slug: "makers",
      title: "  Intro  ",
      description: null,
      coverKey: null,
    });
    expect(parsed.title).toBe("Intro");
  });

  it("rejects an empty or long title with plain messages", () => {
    const empty = createCourseSchema.safeParse({
      slug: "makers",
      title: "  ",
      description: null,
      coverKey: null,
    });
    expect(empty.error?.issues[0]?.message).toBe("Add a title.");
    const long = createCourseSchema.safeParse({
      slug: "makers",
      title: "x".repeat(121),
      description: null,
      coverKey: null,
    });
    expect(long.error?.issues[0]?.message).toBe("Use 120 characters or fewer for the title.");
  });

  it("rejects a community slug that is not a slug", () => {
    expect(recordViewSchema.safeParse({ slug: "../x", lessonId }).success).toBe(false);
  });

  it("requires uuids in reorder lists and at least one id", () => {
    const base = { slug: "makers", courseSlug: "intro" };
    expect(reorderModulesSchema.safeParse({ ...base, ids: [moduleId] }).success).toBe(true);
    expect(reorderModulesSchema.safeParse({ ...base, ids: [] }).success).toBe(false);
    expect(reorderModulesSchema.safeParse({ ...base, ids: ["one"] }).success).toBe(false);
    expect(reorderLessonsSchema.safeParse({ ...base, ids: [lessonId] }).success).toBe(false);
    expect(reorderLessonsSchema.safeParse({ ...base, moduleId, ids: [lessonId] }).success).toBe(
      true,
    );
  });

  it("caps lesson attachments at ten", () => {
    const file = { key: "k", name: "a.pdf", size: 1, contentType: "application/pdf" };
    const lesson = {
      slug: "makers",
      courseSlug: "intro",
      lessonId,
      title: "One",
      bodyMarkdown: "",
      videoUrl: "",
    };
    expect(updateLessonSchema.safeParse({ ...lesson, attachments: [file] }).success).toBe(true);
    const many = updateLessonSchema.safeParse({
      ...lesson,
      attachments: Array.from({ length: 11 }, () => file),
    });
    expect(many.error?.issues[0]?.message).toBe("Attach up to 10 files.");
  });

  it("needs an explicit completion flag", () => {
    const ref = { slug: "makers", courseSlug: "intro", lessonId };
    expect(setLessonCompleteSchema.safeParse(ref).success).toBe(false);
    expect(setLessonCompleteSchema.safeParse({ ...ref, completed: true }).success).toBe(true);
  });
});
