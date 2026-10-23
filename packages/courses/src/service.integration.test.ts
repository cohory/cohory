import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { CommunityArchivedError } from "@cohory/communities/archive";
import type { CommunityId } from "@cohory/db";
import { communities, lessonProgress } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { CourseNotFoundError, CoursesValidationError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService, type CoursesService } from "./service";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
const storage = memoryStorage();
let clock = new Date("2026-10-01T10:00:00Z");
const courses: CoursesService = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage,
  imageHosts: ["images.example.com"],
  now: () => clock,
});

function tick(): void {
  clock = new Date(clock.getTime() + 60_000);
}

afterAll(async () => {
  await close();
});

interface World {
  communityId: CommunityId;
  owner: string;
  admin: string;
  member: string;
  other: string;
}

async function world(): Promise<World> {
  const communityId = await insertCommunity(db);
  return {
    communityId,
    owner: await insertMember(db, communityId, "owner"),
    admin: await insertMember(db, communityId, "admin"),
    member: await insertMember(db, communityId, "member"),
    other: await insertMember(db, communityId, "member"),
  };
}

async function publishedCourse(w: World, title = "Intro to clay") {
  const admin = user(w.admin);
  const course = await courses.createCourse(admin, w.communityId, { title });
  const first = await courses.createModule(admin, w.communityId, course.slug, { title: "Basics" });
  const second = await courses.createModule(admin, w.communityId, course.slug, { title: "Next" });
  const lessons = [];
  for (const [moduleId, lessonTitle] of [
    [first.id, "Welcome"],
    [first.id, "Tools"],
    [second.id, "Wedging"],
    [second.id, "Throwing"],
  ] as const) {
    const lesson = await courses.createLesson(admin, w.communityId, course.slug, moduleId, {
      title: lessonTitle,
      bodyMarkdown: `# ${lessonTitle}`,
    });
    await courses.publishLesson(admin, w.communityId, lesson.id);
    lessons.push(lesson);
  }
  await courses.publishCourse(admin, w.communityId, course.slug);
  return { course, modules: [first, second], lessons };
}

describe("drafts", () => {
  it("hides draft courses and draft lessons from members and shows them to admins", async () => {
    const w = await world();
    const { course, modules } = await publishedCourse(w);
    const draftCourse = await courses.createCourse(user(w.admin), w.communityId, {
      title: "Secret plans",
    });
    const draftLesson = await courses.createLesson(
      user(w.admin),
      w.communityId,
      course.slug,
      modules[0]?.id ?? "",
      { title: "Unfinished" },
    );

    const memberList = await courses.listCourses(user(w.member), w.communityId);
    const adminList = await courses.listCourses(user(w.owner), w.communityId);
    const memberOutline = await courses.getCourse(user(w.member), w.communityId, course.slug);
    const adminOutline = await courses.getCourse(user(w.admin), w.communityId, course.slug);

    expect(memberList.map((c) => c.slug)).toEqual([course.slug]);
    expect(memberList[0]).toMatchObject({ lessonCount: 4, publishedLessonCount: 4 });
    expect(adminList.map((c) => [c.slug, c.status])).toEqual([
      [course.slug, "published"],
      [draftCourse.slug, "draft"],
    ]);
    expect(memberOutline.modules.flatMap((m) => m.lessons).map((l) => l.id)).not.toContain(
      draftLesson.id,
    );
    expect(adminOutline.modules[0]?.lessons.map((l) => l.title)).toEqual([
      "Welcome",
      "Tools",
      "Unfinished",
    ]);
    expect(adminOutline.publishedLessonCount).toBe(4);
    await expect(
      courses.getCourse(user(w.member), w.communityId, draftCourse.slug),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.getLesson(user(w.member), w.communityId, course.slug, draftLesson.slug),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.markLessonComplete(user(w.member), w.communityId, draftLesson.id),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    const preview = await courses.getLesson(
      user(w.admin),
      w.communityId,
      course.slug,
      draftLesson.slug,
    );
    expect(preview.status).toBe("draft");
  });

  it("lets only admins and owners write, and answers 403 to members", async () => {
    const w = await world();
    const { course } = await publishedCourse(w);
    const moderator = await insertMember(db, w.communityId, "moderator");

    for (const actor of [user(w.member), user(moderator)]) {
      await expect(
        courses.createCourse(actor, w.communityId, { title: "Nope" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        courses.unpublishCourse(actor, w.communityId, course.slug),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      courses.createCourse(user(w.owner), w.communityId, { title: "Owner course" }),
    ).resolves.toMatchObject({ status: "draft" });
  });

  it("denies guests and outsiders", async () => {
    const w = await world();
    const outsider = await insertMember(db, await insertCommunity(db));

    await expect(courses.listCourses({ kind: "guest" }, w.communityId)).rejects.toBeInstanceOf(
      CourseNotFoundError,
    );
    await expect(courses.listCourses(user(outsider), w.communityId)).rejects.toBeInstanceOf(
      CourseNotFoundError,
    );
    await expect(
      courses.recordLessonView({ kind: "guest" }, w.communityId, w.member),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("published course count", () => {
  it("counts published courses for visitors of a public community without listing them", async () => {
    const communityId = await insertCommunity(db, "public");
    const admin = await insertMember(db, communityId, "admin");
    const w = { communityId, owner: admin, admin, member: admin, other: admin };
    await publishedCourse(w, "Glazing");
    await publishedCourse(w, "Firing");
    await courses.createCourse(user(admin), communityId, { title: "Draft only" });
    const outsider = await insertMember(db, await insertCommunity(db));

    await expect(courses.countPublishedCourses({ kind: "guest" }, communityId)).resolves.toBe(2);
    await expect(courses.countPublishedCourses(user(outsider), communityId)).resolves.toBe(2);
    await expect(courses.countPublishedCourses(user(admin), communityId)).resolves.toBe(2);
    await expect(courses.listCourses({ kind: "guest" }, communityId)).rejects.toThrow();
  });

  it("hides the count of a private community from people who are not members", async () => {
    const w = await world();
    await publishedCourse(w);
    const outsider = await insertMember(db, await insertCommunity(db));

    await expect(
      courses.countPublishedCourses({ kind: "guest" }, w.communityId),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.countPublishedCourses(user(outsider), w.communityId),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(courses.countPublishedCourses(user(w.member), w.communityId)).resolves.toBe(1);
  });
});

describe("course previews for visitors", () => {
  it("gives visitors of a public community titles and published lesson counts, never lessons", async () => {
    const communityId = await insertCommunity(db, "public");
    const admin = await insertMember(db, communityId, "admin");
    const w = { communityId, owner: admin, admin, member: admin, other: admin };
    const { course, modules } = await publishedCourse(w, "Glazing");
    const [firstModule] = modules;
    if (!firstModule) throw new Error("no module");
    await courses.createLesson(user(admin), communityId, course.slug, firstModule.id, {
      title: "Draft lesson",
      bodyMarkdown: "# Draft",
    });
    await courses.createCourse(user(admin), communityId, { title: "Draft only" });
    const outsider = await insertMember(db, await insertCommunity(db));

    const expected = [{ title: "Glazing", coverKey: null, lessonCount: 4 }];
    await expect(courses.listCoursePreviews({ kind: "guest" }, communityId)).resolves.toEqual(
      expected,
    );
    await expect(courses.listCoursePreviews(user(outsider), communityId)).resolves.toEqual(
      expected,
    );
  });

  it("refuses previews of a private community to people who are not members", async () => {
    const w = await world();
    await publishedCourse(w, "Members only");
    const outsider = await insertMember(db, await insertCommunity(db));

    await expect(
      courses.listCoursePreviews({ kind: "guest" }, w.communityId),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(courses.listCoursePreviews(user(outsider), w.communityId)).rejects.toBeInstanceOf(
      CourseNotFoundError,
    );
    await expect(courses.listCoursePreviews(user(w.member), w.communityId)).resolves.toEqual([
      { title: "Members only", coverKey: null, lessonCount: 4 },
    ]);
  });
});

describe("tenancy", () => {
  it("never reaches a course or lesson of another community", async () => {
    const a = await world();
    const b = await world();
    const { course, lessons } = await publishedCourse(a, "Shared title");
    const lessonId = lessons[0]?.id ?? "";

    await expect(
      courses.getCourse(user(b.admin), b.communityId, course.slug),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.markLessonComplete(user(b.member), b.communityId, lessonId),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.updateLesson(user(b.admin), b.communityId, lessonId, { title: "x" }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.uploadLessonAttachment(user(b.admin), b.communityId, course.id, {
        bytes: new TextEncoder().encode("hi"),
        name: "a.txt",
        declaredType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    const same = await courses.createCourse(user(b.admin), b.communityId, {
      title: "Shared title",
    });
    expect(same.slug).toBe(course.slug);
  });
});

describe("slugs", () => {
  it("adds numeric suffixes per community and per course and avoids reserved words", async () => {
    const w = await world();
    const admin = user(w.admin);
    const first = await courses.createCourse(admin, w.communityId, { title: "Pottery 101" });
    const second = await courses.createCourse(admin, w.communityId, { title: "pottery 101!" });
    const reserved = await courses.createCourse(admin, w.communityId, { title: "New" });
    const module = await courses.createModule(admin, w.communityId, first.slug, { title: "M" });
    const a = await courses.createLesson(admin, w.communityId, first.slug, module.id, {
      title: "Intro",
    });
    const b = await courses.createLesson(admin, w.communityId, first.slug, module.id, {
      title: "Intro",
    });
    await courses.updateCourse(admin, w.communityId, first.slug, { title: "Renamed" });

    expect([first.slug, second.slug, reserved.slug]).toEqual([
      "pottery-101",
      "pottery-101-2",
      "new-2",
    ]);
    expect([a.slug, b.slug]).toEqual(["intro", "intro-2"]);
    expect((await courses.getCourse(admin, w.communityId, first.slug)).title).toBe("Renamed");
  });
});

describe("reordering", () => {
  it("persists module and lesson order and rejects partial lists", async () => {
    const w = await world();
    const { course, modules, lessons } = await publishedCourse(w);
    const admin = user(w.admin);
    const [m1, m2] = modules;
    const [l1, l2, l3, l4] = lessons;
    if (!m1 || !m2 || !l1 || !l2 || !l3 || !l4) {
      throw new Error("fixture incomplete");
    }

    await courses.reorderModules(admin, w.communityId, course.slug, { ids: [m2.id, m1.id] });
    await courses.reorderLessons(admin, w.communityId, course.slug, m2.id, {
      ids: [l4.id, l3.id],
    });
    await courses.updateLesson(admin, w.communityId, l1.id, { moduleId: m2.id });
    const outline = await courses.getCourse(user(w.member), w.communityId, course.slug);

    expect(outline.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])).toEqual([
      ["Next", ["Throwing", "Wedging", "Welcome"]],
      ["Basics", ["Tools"]],
    ]);
    await expect(
      courses.reorderModules(admin, w.communityId, course.slug, { ids: [m1.id] }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
    await expect(
      courses.reorderLessons(admin, w.communityId, course.slug, m1.id, { ids: [l3.id] }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });

  it("keeps the order through repeated moves that exhaust the gaps", async () => {
    const w = await world();
    const { course, lessons } = await publishedCourse(w);
    const admin = user(w.admin);
    const outline = await courses.getCourse(admin, w.communityId, course.slug);
    const moduleId = outline.modules[0]?.id ?? "";
    let order = outline.modules[0]?.lessons.map((l) => l.id) ?? [];

    for (let i = 0; i < 14; i += 1) {
      order = [order[1] ?? "", order[0] ?? "", ...order.slice(2)];
      order = [order[0] ?? "", ...order.slice(1).reverse()];
      await courses.reorderLessons(admin, w.communityId, course.slug, moduleId, { ids: order });
    }
    const after = await courses.getCourse(admin, w.communityId, course.slug);

    expect(after.modules[0]?.lessons.map((l) => l.id)).toEqual(order);
    expect(lessons).toHaveLength(4);
  });
});

describe("progress", () => {
  it("is isolated between users and counts published lessons only", async () => {
    const w = await world();
    const { course, lessons, modules } = await publishedCourse(w);
    await courses.createLesson(user(w.admin), w.communityId, course.slug, modules[0]?.id ?? "", {
      title: "Draft extra",
    });
    const [l1, l2] = lessons;

    await courses.markLessonComplete(user(w.member), w.communityId, l1?.id ?? "");
    const progress = await courses.markLessonComplete(user(w.member), w.communityId, l2?.id ?? "");
    const mine = await courses.listCourses(user(w.member), w.communityId);
    const theirs = await courses.listCourses(user(w.other), w.communityId);
    const outline = await courses.getCourse(user(w.other), w.communityId, course.slug);

    expect(progress).toMatchObject({
      completedLessonCount: 2,
      publishedLessonCount: 4,
      progressPercent: 50,
    });
    expect(mine[0]?.progressPercent).toBe(50);
    expect(theirs[0]?.progressPercent).toBe(0);
    expect(outline.modules.flatMap((m) => m.lessons).some((l) => l.completed)).toBe(false);

    const undone = await courses.markLessonIncomplete(user(w.member), w.communityId, l2?.id ?? "");
    expect(undone.progressPercent).toBe(25);
  });

  it("returns lesson html, neighbours, and completion", async () => {
    const w = await world();
    const { course, lessons } = await publishedCourse(w);
    const [l1, l2, l3] = lessons;
    await courses.updateLesson(user(w.admin), w.communityId, l2?.id ?? "", {
      bodyMarkdown: "Hello <script>alert(1)</script> ![x](https://images.example.com/a.png)",
      videoUrl: "https://www.youtube.com/watch?v=abc",
    });
    await courses.markLessonComplete(user(w.member), w.communityId, l2?.id ?? "");

    const lesson = await courses.getLesson(
      user(w.member),
      w.communityId,
      course.slug,
      l2?.slug ?? "",
    );

    expect(lesson.previousLesson?.id).toBe(l1?.id);
    expect(lesson.nextLesson?.id).toBe(l3?.id);
    expect(lesson.bodyHtml).not.toContain("<script>");
    expect(lesson.bodyHtml).toContain('<img src="https://images.example.com/a.png"');
    expect(lesson.videoProvider).toBe("youtube");
    expect(lesson.completedAt).toEqual(clock);
  });

  it("rejects video urls outside the embed allowlist", async () => {
    const w = await world();
    const { lessons } = await publishedCourse(w);

    await expect(
      courses.updateLesson(user(w.admin), w.communityId, lessons[0]?.id ?? "", {
        videoUrl: "https://evil.test/video.mp4",
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });
});

describe("continue learning", () => {
  it("picks the most recent incomplete lesson, then the next incomplete one", async () => {
    const w = await world();
    const pottery = await publishedCourse(w, "Pottery");
    const glazing = await publishedCourse(w, "Glazing");
    const member = user(w.member);

    expect(await courses.getContinueLearning(member, w.communityId)).toBeNull();

    tick();
    await courses.recordLessonView(member, w.communityId, pottery.lessons[2]?.id ?? "");
    tick();
    await courses.recordLessonView(member, w.communityId, glazing.lessons[1]?.id ?? "");
    const first = await courses.getContinueLearning(member, w.communityId);

    tick();
    await courses.markLessonComplete(member, w.communityId, glazing.lessons[1]?.id ?? "");
    const second = await courses.getContinueLearning(member, w.communityId);

    for (const lesson of glazing.lessons) {
      tick();
      await courses.markLessonComplete(member, w.communityId, lesson.id);
    }
    const third = await courses.getContinueLearning(member, w.communityId);
    await courses.unpublishCourse(user(w.admin), w.communityId, pottery.course.slug);
    const fourth = await courses.getContinueLearning(member, w.communityId);

    expect(first).toMatchObject({
      course: { slug: glazing.course.slug },
      lesson: { id: glazing.lessons[1]?.id },
      progressPercent: 0,
    });
    expect(second).toMatchObject({
      lesson: { id: glazing.lessons[0]?.id },
      progressPercent: 25,
    });
    expect(third).toMatchObject({
      course: { slug: pottery.course.slug },
      lesson: { id: pottery.lessons[2]?.id },
    });
    expect(fourth).toBeNull();
    expect(await courses.getContinueLearning(user(w.other), w.communityId)).toBeNull();
  });
});

describe("deleting", () => {
  it("hard deletes a course without progress and archives one with progress", async () => {
    const w = await world();
    const fresh = await courses.createCourse(user(w.admin), w.communityId, { title: "Fresh" });
    const { course, lessons } = await publishedCourse(w, "Taken");
    await courses.recordLessonView(user(w.member), w.communityId, lessons[0]?.id ?? "");

    const deleted = await courses.deleteCourse(user(w.admin), w.communityId, fresh.slug);
    const archived = await courses.deleteCourse(user(w.admin), w.communityId, course.slug);

    expect(deleted).toEqual({ outcome: "deleted" });
    expect(archived).toEqual({ outcome: "archived" });
    expect((await courses.listCourses(user(w.member), w.communityId)).length).toBe(0);
    expect(
      (await courses.listCourses(user(w.admin), w.communityId)).map((c) => [c.slug, c.status]),
    ).toEqual([[course.slug, "archived"]]);
  });

  it("deletes modules and lessons", async () => {
    const w = await world();
    const { course, modules, lessons } = await publishedCourse(w);
    const admin = user(w.admin);

    await courses.deleteLesson(admin, w.communityId, lessons[0]?.id ?? "");
    await courses.deleteModule(admin, w.communityId, course.slug, modules[1]?.id ?? "");
    const outline = await courses.getCourse(admin, w.communityId, course.slug);

    expect(outline.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])).toEqual([
      ["Basics", ["Tools"]],
    ]);
  });
});

describe("attachments", () => {
  it("stores uploads under the course folder and accepts only those keys on lessons", async () => {
    const w = await world();
    const { course, lessons } = await publishedCourse(w);
    const other = await publishedCourse(w, "Other");
    const admin = user(w.admin);
    const pdf = new TextEncoder().encode("%PDF-1.7\n");

    const ref = await courses.uploadLessonAttachment(admin, w.communityId, course.id, {
      bytes: pdf,
      name: "worksheet.pdf",
      declaredType: "application/pdf",
    });
    const foreign = await courses.uploadLessonAttachment(admin, w.communityId, other.course.id, {
      bytes: pdf,
      name: "other.pdf",
      declaredType: "application/pdf",
    });
    const saved = await courses.updateLesson(admin, w.communityId, lessons[0]?.id ?? "", {
      attachments: [ref],
    });

    expect(
      ref.key.startsWith(`communities/${w.communityId}/courses/${course.id}/attachments/`),
    ).toBe(true);
    expect(ref).toMatchObject({
      name: "worksheet.pdf",
      size: pdf.byteLength,
      contentType: "application/pdf",
    });
    expect(storage.objects.has(ref.key)).toBe(true);
    expect(saved.attachments).toEqual([ref]);
    await expect(
      courses.updateLesson(admin, w.communityId, lessons[0]?.id ?? "", {
        attachments: [foreign],
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
    await expect(
      courses.uploadLessonAttachment(user(w.member), w.communityId, course.id, {
        bytes: pdf,
        name: "x.pdf",
        declaredType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves an attachment only while the lesson that holds it is visible", async () => {
    const w = await world();
    const { course, lessons } = await publishedCourse(w);
    const admin = user(w.admin);
    const member = user(w.member);
    const lessonId = lessons[1]?.id ?? "";
    const ref = await courses.uploadLessonAttachment(admin, w.communityId, course.id, {
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
      name: "Week 2 notes.pdf",
      declaredType: "application/pdf",
    });

    await expect(
      courses.getLessonAttachment(member, w.communityId, ref.key),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await courses.updateLesson(admin, w.communityId, lessonId, { attachments: [ref] });
    await expect(courses.getLessonAttachment(member, w.communityId, ref.key)).resolves.toEqual(ref);

    await courses.unpublishLesson(admin, w.communityId, lessonId);
    await expect(
      courses.getLessonAttachment(member, w.communityId, ref.key),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(courses.getLessonAttachment(admin, w.communityId, ref.key)).resolves.toEqual(ref);

    const outsider = await insertMember(db, await insertCommunity(db));
    await expect(
      courses.getLessonAttachment(user(outsider), w.communityId, ref.key),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });
});

describe("archived community", () => {
  it("keeps courses readable, skips view tracking, and rejects every write", async () => {
    const w = await world();
    const { course, modules, lessons } = await publishedCourse(w);
    const [l1, l2] = lessons;
    await db
      .update(communities)
      .set({ archivedAt: clock })
      .where(eq(communities.id, w.communityId));
    const admin = user(w.admin);
    const member = user(w.member);
    const moduleId = modules[0]?.id ?? "";
    const pdf = new TextEncoder().encode("%PDF-1.7\n");

    expect(await courses.listCourses(member, w.communityId)).toHaveLength(1);
    expect((await courses.getCourse(member, w.communityId, course.slug)).slug).toBe(course.slug);
    await courses.recordLessonView(member, w.communityId, l1?.id ?? "");
    const writes = [
      () => courses.createCourse(admin, w.communityId, { title: "Another" }),
      () => courses.updateCourse(admin, w.communityId, course.slug, { title: "Renamed" }),
      () => courses.unpublishCourse(admin, w.communityId, course.slug),
      () => courses.createModule(admin, w.communityId, course.slug, { title: "More" }),
      () => courses.updateModule(admin, w.communityId, course.slug, moduleId, { title: "Basic" }),
      () => courses.createLesson(admin, w.communityId, course.slug, moduleId, { title: "New" }),
      () => courses.updateLesson(admin, w.communityId, l2?.id ?? "", { title: "Edited" }),
      () => courses.deleteLesson(admin, w.communityId, l2?.id ?? ""),
      () =>
        courses.uploadLessonAttachment(admin, w.communityId, course.id, {
          bytes: pdf,
          name: "late.pdf",
          declaredType: "application/pdf",
        }),
      () => courses.markLessonComplete(member, w.communityId, l1?.id ?? ""),
      () => courses.markLessonIncomplete(member, w.communityId, l1?.id ?? ""),
      () => courses.deleteCourse(admin, w.communityId, course.slug),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(CommunityArchivedError);
    }
    const progress = await db
      .select()
      .from(lessonProgress)
      .where(
        and(eq(lessonProgress.communityId, w.communityId), eq(lessonProgress.userId, w.member)),
      );
    expect(progress).toEqual([]);
  });
});
