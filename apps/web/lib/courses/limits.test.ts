import { maxDescriptionLength, maxLessonBodyLength, maxTitleLength } from "@cohory/courses";
import { maxTitleLength as maxPostTitleLength } from "@cohory/posts";
import { lessonFormLimits, postComposerLimits } from "@cohory/ui";
import { describe, expect, it } from "vitest";

import { courseFormLimits } from "../../components/classroom/course-form";

describe("form limits", () => {
  it("match the course service so the field stops where the server does", () => {
    expect(lessonFormLimits.title).toBe(maxTitleLength);
    expect(lessonFormLimits.body).toBe(maxLessonBodyLength);
    expect(courseFormLimits).toEqual({ title: maxTitleLength, description: maxDescriptionLength });
  });

  it("match the posts service for the composer title", () => {
    expect(postComposerLimits.title).toBe(maxPostTitleLength);
  });
});
