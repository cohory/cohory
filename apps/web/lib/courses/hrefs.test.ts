import { describe, expect, it } from "vitest";

import {
  attachmentHref,
  classroomHref,
  courseHref,
  lessonHref,
  newCourseHref,
  uploadHref,
} from "./hrefs";

describe("classroom hrefs", () => {
  it("builds classroom, course, and lesson paths under the community", () => {
    expect(classroomHref("makers")).toBe("/c/makers/classroom");
    expect(newCourseHref("makers")).toBe("/c/makers/classroom/new");
    expect(courseHref("makers", "getting-started")).toBe("/c/makers/classroom/getting-started");
    expect(lessonHref("makers", "getting-started", "welcome")).toBe(
      "/c/makers/classroom/getting-started/welcome",
    );
  });

  it("adds the edit flag only when asked", () => {
    expect(courseHref("makers", "intro", { edit: true })).toBe("/c/makers/classroom/intro?edit=1");
    expect(lessonHref("makers", "intro", "one", { edit: false })).toBe(
      "/c/makers/classroom/intro/one",
    );
    expect(lessonHref("makers", "intro", "one", { edit: true })).toBe(
      "/c/makers/classroom/intro/one?edit=1",
    );
  });

  it("encodes segments so a slug can never escape its path", () => {
    expect(lessonHref("makers", "a/b", "c?d")).toBe("/c/makers/classroom/a%2Fb/c%3Fd");
  });

  it("serves uploads and attachments through the uploads route", () => {
    const key = "communities/0192f2a4-0000-7000-8000-000000000001/courses/x/attachments/y.pdf";
    expect(uploadHref(key)).toBe(`/api/uploads/${key}`);
    expect(attachmentHref(key)).toBe(`/api/uploads/${key}`);
  });
});
