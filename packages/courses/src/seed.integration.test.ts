import { getCommunityBySlug } from "@cohory/db";
import { courseModules, courses, lessons } from "@cohory/db/schema";
import { devSeed, seedDevData } from "@cohory/db/seed";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { devCourseSlug, seedDevCourses } from "./seed";
import { devCourseOutline } from "./seed-course";
import { openTestDb } from "./test/fixtures";

const admin = openTestDb();

afterAll(async () => {
  await admin.close();
});

describe("courses dev seed", () => {
  it("creates the published Classroom guide with one draft lesson, once", async () => {
    await seedDevData(admin.db);
    const first = await seedDevCourses(admin.db);
    const again = await seedDevCourses(admin.db);
    const community = await getCommunityBySlug(admin.db, devSeed.communitySlug);
    if (!community) throw new Error("no dev community");
    const [course] = await admin.db
      .select()
      .from(courses)
      .where(and(eq(courses.communityId, community.id), eq(courses.slug, devCourseSlug)));
    const modules = await admin.db
      .select({ title: courseModules.title })
      .from(courseModules)
      .where(eq(courseModules.courseId, course?.id ?? ""))
      .orderBy(asc(courseModules.position));
    const rows = await admin.db
      .select({ title: lessons.title, status: lessons.status })
      .from(lessons)
      .where(eq(lessons.courseId, course?.id ?? ""));
    const lessonCount = devCourseOutline.reduce((sum, module) => sum + module.lessons.length, 0);

    expect(first).toEqual({ coursesCreated: 1, lessonsCreated: lessonCount });
    expect(again).toEqual({ coursesCreated: 0, lessonsCreated: 0 });
    expect(course).toMatchObject({ title: "How to use Cohory Classroom", status: "published" });
    expect(modules.map((module) => module.title)).toEqual(
      devCourseOutline.map((module) => module.title),
    );
    expect(rows.filter((row) => row.status === "draft").map((row) => row.title)).toEqual([
      "A draft lesson",
    ]);
  });
});
