import type { CourseSummary, LessonSummary, ModuleView } from "@cohory/courses";
import { describe, expect, it } from "vitest";

import {
  courseFinished,
  lessonNeighbors,
  lessonProgress,
  nextLiveCall,
  nextCourseAfter,
  resumeTarget,
  toAttachmentRefs,
  toCourseCards,
  toLessonAttachments,
  toOutline,
  visibleModules,
} from "./views";

function course(overrides: Partial<CourseSummary>): CourseSummary {
  return {
    id: "0192f2a4-0000-7000-8000-000000000010",
    slug: "intro",
    title: "Intro",
    description: null,
    coverKey: null,
    status: "published",
    position: 1,
    lessonCount: 3,
    publishedLessonCount: 2,
    completedLessonCount: 1,
    progressPercent: 50,
    requiredLevel: null,
    locked: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function lesson(slug: string, overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: `id-${slug}`,
    moduleId: "m1",
    slug,
    title: slug,
    status: "published",
    position: 1,
    hasVideo: false,
    completed: false,
    ...overrides,
  };
}

function module(lessons: LessonSummary[]): ModuleView {
  return { id: "m1", courseId: "c1", title: "Module 1", position: 1, lessons };
}

describe("toCourseCards", () => {
  const courses = [
    course({ slug: "live" }),
    course({ slug: "draft", status: "draft" }),
    course({ slug: "old", status: "archived" }),
  ];

  it("hides draft and archived courses from members", () => {
    const cards = toCourseCards("makers", courses, { manager: false, showProgress: true });
    expect(cards.map((card) => card.course.slug)).toEqual(["live"]);
    expect(cards[0]).toMatchObject({ href: "/c/makers/classroom/live", progressPercent: 50 });
  });

  it("shows every course with its status to managers", () => {
    const cards = toCourseCards("makers", courses, { manager: true, showProgress: false });
    expect(cards.map((card) => card.course.status)).toEqual(["published", "draft", "archived"]);
    expect(cards.every((card) => card.progressPercent === null)).toBe(true);
  });

  it("maps a cover key to the uploads route and skips progress without lessons", () => {
    const key = "communities/0192f2a4-0000-7000-8000-000000000001/posts/a.png";
    const [card] = toCourseCards(
      "makers",
      [course({ coverKey: key, publishedLessonCount: 0, progressPercent: 0 })],
      { manager: false, showProgress: true },
    );
    expect(card?.course.coverUrl).toBe(`/api/uploads/${key}`);
    expect(card?.progressPercent).toBeNull();
  });
});

describe("visibleModules", () => {
  const modules = [module([lesson("one"), lesson("two", { status: "draft" })])];

  it("drops draft lessons for members and keeps them for managers", () => {
    expect(visibleModules(modules, false)[0]?.lessons.map((row) => row.slug)).toEqual(["one"]);
    expect(visibleModules(modules, true)[0]?.lessons.map((row) => row.slug)).toEqual([
      "one",
      "two",
    ]);
  });

  it("builds lesson hrefs for the outline", () => {
    const [first] = toOutline("makers", "intro", modules);
    expect(first?.lessons.map((row) => row.href)).toEqual([
      "/c/makers/classroom/intro/one",
      "/c/makers/classroom/intro/two",
    ]);
  });
});

describe("resumeTarget", () => {
  it("starts at the first published lesson when nothing is complete", () => {
    expect(resumeTarget([module([lesson("draft", { status: "draft" }), lesson("one")])])).toEqual({
      label: "Start",
      lessonSlug: "one",
    });
  });

  it("continues at the first incomplete published lesson", () => {
    const modules = [module([lesson("one", { completed: true }), lesson("two")])];
    expect(resumeTarget(modules)).toEqual({ label: "Continue", lessonSlug: "two" });
  });

  it("offers a review once everything is complete, and nothing without lessons", () => {
    expect(resumeTarget([module([lesson("one", { completed: true })])])).toEqual({
      label: "Review",
      lessonSlug: "one",
    });
    expect(resumeTarget([module([lesson("x", { status: "draft" })])])).toBeNull();
  });
});

describe("attachments", () => {
  it("round trips attachment refs through the lesson form shape", () => {
    const refs = [
      {
        key: "communities/a/courses/b/attachments/c.pdf",
        name: "Notes.pdf",
        size: 10,
        contentType: "application/pdf",
      },
    ];
    const shown = toLessonAttachments(refs);
    expect(shown[0]?.href).toBe("/api/uploads/communities/a/courses/b/attachments/c.pdf");
    expect(toAttachmentRefs(shown)).toEqual(refs);
  });
});

describe("lessonNeighbors", () => {
  const modules = [
    module([lesson("one"), lesson("two", { status: "draft" })]),
    { ...module([lesson("three")]), id: "m2" },
  ];

  it("links across modules within the lessons it is given", () => {
    const visible = visibleModules(modules, false);
    expect(lessonNeighbors(visible, "id-one")).toEqual({
      previous: null,
      next: { slug: "three" },
    });
    expect(lessonNeighbors(visible, "id-three")).toEqual({ previous: { slug: "one" }, next: null });
  });

  it("returns no neighbors for a lesson that is not in the list", () => {
    expect(lessonNeighbors(visibleModules(modules, false), "id-two")).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe("lessonProgress", () => {
  const outline = toOutline("makers", "intro", [
    module([
      lesson("one", { completed: true }),
      lesson("two", { status: "draft" }),
      lesson("three"),
      lesson("four"),
    ]),
  ]);

  it("counts the position among shown lessons and progress over published ones", () => {
    expect(lessonProgress(outline, "id-three", true)).toEqual({
      position: 3,
      total: 4,
      percent: 33,
    });
  });

  it("leaves out the percent when progress is not tracked", () => {
    expect(lessonProgress(outline, "id-one", false)).toEqual({
      position: 1,
      total: 4,
      percent: null,
    });
  });

  it("returns nothing for a lesson outside the outline", () => {
    expect(lessonProgress(outline, "missing", true)).toBeNull();
  });
});

describe("courseFinished", () => {
  it("is true only when every published lesson is complete", () => {
    const done = toOutline("makers", "intro", [
      module([lesson("one", { completed: true }), lesson("two", { status: "draft" })]),
    ]);
    const open = toOutline("makers", "intro", [
      module([lesson("one", { completed: true }), lesson("two")]),
    ]);

    expect(courseFinished(done)).toBe(true);
    expect(courseFinished(open)).toBe(false);
    expect(courseFinished([])).toBe(false);
  });
});

describe("nextCourseAfter", () => {
  const courses = [
    course({ slug: "first", progressPercent: 0 }),
    course({ slug: "current", progressPercent: 100 }),
    course({ slug: "draft", status: "draft", progressPercent: 0 }),
    course({ slug: "empty", publishedLessonCount: 0, progressPercent: 0 }),
    course({ slug: "done", progressPercent: 100 }),
    course({ slug: "later", progressPercent: 20 }),
  ];

  it("picks the next published course with lessons left, after the current one first", () => {
    expect(nextCourseAfter(courses, "current")?.slug).toBe("later");
  });

  it("wraps around to earlier courses", () => {
    expect(nextCourseAfter(courses.slice(0, 2), "current")?.slug).toBe("first");
  });

  it("returns nothing when every other course is finished", () => {
    expect(nextCourseAfter([course({ slug: "current" })], "current")).toBeNull();
  });
});

describe("nextLiveCall", () => {
  const occurrence = {
    id: "o1",
    eventSlug: "office-hours",
    title: "Office hours",
    startsAt: "2026-11-03T17:00:00.000Z",
    endsAt: "2026-11-03T18:00:00.000Z",
    canceled: false,
    recurrence: null,
    goingCount: 1,
    viewerStatus: "going" as const,
    locationKind: null,
  };

  it("names the first call that is not canceled, in the viewer's time zone", () => {
    const canceled = { ...occurrence, id: "o0", canceled: true };
    expect(nextLiveCall([canceled, occurrence], "makers", "Europe/London")).toEqual({
      title: "Office hours",
      when: "Tuesday 3 November, 17:00 GMT",
      href: "/c/makers/calendar/office-hours/o1",
    });
  });

  it("returns nothing without upcoming calls", () => {
    expect(nextLiveCall([], "makers", "UTC")).toBeNull();
  });
});
