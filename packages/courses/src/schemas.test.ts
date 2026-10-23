import { describe, expect, it } from "vitest";

import { createCourseInputSchema, createLessonInputSchema } from "./schemas";

const zeroWidthSpace = String.fromCodePoint(0x200b);
const tagA = String.fromCodePoint(0xe0041);
const rightToLeftOverride = String.fromCodePoint(0x202e);

describe("course and lesson input", () => {
  it("strips invisible characters from lesson markdown and course descriptions", () => {
    expect(
      createLessonInputSchema.parse({
        title: "Clay",
        bodyMarkdown: `Wedge${zeroWidthSpace} the clay${tagA}`,
      }).bodyMarkdown,
    ).toBe("Wedge the clay");
    expect(
      createCourseInputSchema.parse({
        title: "Pottery",
        description: `Hands${rightToLeftOverride} on`,
      }).description,
    ).toBe("Hands on");
  });
});
