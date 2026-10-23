import { describe, expect, it } from "vitest";

import { emptyArchiveRecords } from "../test/records";
import { planImportSlugs } from "./slugs";

const communityId = "0199f0a0-0000-7000-8000-000000000001";
const stamp = "2026-10-01T00:00:00.000Z";

function course(id: string, slug: string, title = "A course") {
  return {
    id,
    slug,
    title,
    description: null,
    coverKey: null,
    status: "published" as const,
    position: 0,
    access: "all_members" as const,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function lesson(id: string, courseId: string, slug: string) {
  return {
    id,
    courseId,
    moduleId: "m",
    slug,
    title: "A lesson",
    bodyMarkdown: null,
    videoUrl: null,
    attachments: [],
    status: "published" as const,
    position: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function event(id: string, slug: string) {
  return {
    id,
    slug,
    title: "An event",
    description: null,
    startsAtLocal: "2026-11-01T18:00",
    timeZone: "UTC",
    durationMinutes: 60,
    recurrence: null,
    recurrenceUntil: null,
    location: null,
    recordingUrl: null,
    createdAt: stamp,
  };
}

describe("planImportSlugs", () => {
  it("normalizes slugs like new courses, lessons, and events and keeps them unique", () => {
    const records = {
      ...emptyArchiveRecords(communityId),
      courses: [
        course("c1", "Intro To Go!"),
        course("c2", "intro-to-go"),
        course("c3", "new"),
        course("c4", "---", "Ünïcode Title"),
        course("c5", "already-fine"),
      ],
      lessons: [
        lesson("l1", "c1", "Lesson_One"),
        lesson("l2", "c1", "lesson-one"),
        lesson("l3", "c2", "lesson-one"),
        lesson("l4", "c2", "edit"),
      ],
      events: [event("e1", "Launch Party"), event("e2", "launch-party"), event("e3", "ics")],
    };

    const slugs = planImportSlugs(records);

    expect(["c1", "c2", "c3", "c4", "c5"].map((id) => slugs.course(id))).toEqual([
      "intro-to-go-2",
      "intro-to-go",
      "new-2",
      "unicode-title",
      "already-fine",
    ]);
    expect(["l1", "l2", "l3", "l4"].map((id) => slugs.lesson(id))).toEqual([
      "lesson-one-2",
      "lesson-one",
      "lesson-one",
      "edit-2",
    ]);
    expect(["e1", "e2", "e3"].map((id) => slugs.event(id))).toEqual([
      "launch-party-2",
      "launch-party",
      "ics-2",
    ]);
    for (const value of [
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => slugs.course(id)),
      ...["l1", "l2", "l3", "l4"].map((id) => slugs.lesson(id)),
      ...["e1", "e2", "e3"].map((id) => slugs.event(id)),
    ]) {
      expect(value).toMatch(/^[a-z0-9-]+$/);
    }
    expect(slugs.renamed).toContainEqual({
      entity: "course",
      from: "Intro To Go!",
      to: "intro-to-go-2",
    });
    expect(slugs.renamed).toContainEqual({ entity: "event", from: "ics", to: "ics-2" });
    expect(slugs.renamed.find((row) => row.from === "already-fine")).toBeUndefined();
  });
});
