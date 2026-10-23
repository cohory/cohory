import { ForbiddenError } from "@cohory/authz";
import { runInCommunity, withCommunity, type CommunityId } from "@cohory/db";
import { communities, memberStats } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { CourseNotFoundError, CoursesValidationError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
const now = new Date("2026-10-22T10:00:00Z");
const courses = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage: memoryStorage(),
  now: () => now,
});

afterAll(async () => {
  await close();
});

async function setLevel(communityId: CommunityId, userId: string, level: number) {
  await runInCommunity(withCommunity(db, communityId), ({ tx, values }) =>
    tx
      .insert(memberStats)
      .values(values({ userId, pointsTotal: 100, level, updatedAt: now }))
      .onConflictDoUpdate({
        target: [memberStats.communityId, memberStats.userId],
        set: { level },
      }),
  );
}

async function lockedCourse(requiredLevel = 3) {
  const communityId = await insertCommunity(db);
  const owner = await insertMember(db, communityId, "owner");
  const member = await insertMember(db, communityId, "member");
  const admin = user(owner);
  const course = await courses.createCourse(admin, communityId, { title: "Advanced glazes" });
  const module = await courses.createModule(admin, communityId, course.slug, { title: "Basics" });
  const lesson = await courses.createLesson(admin, communityId, course.slug, module.id, {
    title: "Ash glaze",
    bodyMarkdown: "Wood ash glaze recipes",
  });
  await courses.publishLesson(admin, communityId, lesson.id);
  await courses.publishCourse(admin, communityId, course.slug);
  await courses.updateCourse(admin, communityId, course.slug, { requiredLevel });
  return { communityId, owner, member, course, lesson };
}

async function notFoundSubject(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof CourseNotFoundError) return error.subject;
    throw error;
  }
  throw new Error("expected a not found error");
}

describe("courses locked until a level", () => {
  it("lets the creator set and clear the required level", async () => {
    const { communityId, owner, course } = await lockedCourse(4);

    expect((await courses.getCourse(user(owner), communityId, course.slug)).requiredLevel).toBe(4);
    const cleared = await courses.updateCourse(user(owner), communityId, course.slug, {
      requiredLevel: null,
    });
    expect(cleared.requiredLevel).toBeNull();
  });

  it("refuses a required level outside 1 to 9", async () => {
    const { communityId, owner, course } = await lockedCourse();

    await expect(
      courses.updateCourse(user(owner), communityId, course.slug, { requiredLevel: 10 }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });

  it("refuses a member who tries to set a required level", async () => {
    const { communityId, member, course } = await lockedCourse();

    await expect(
      courses.updateCourse(user(member), communityId, course.slug, { requiredLevel: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows the course as locked to a member below the level, without its lessons", async () => {
    const { communityId, member, course } = await lockedCourse(3);
    await setLevel(communityId, member, 2);

    const [summary] = await courses.listCourses(user(member), communityId);
    expect(summary).toMatchObject({ slug: course.slug, requiredLevel: 3, locked: true });
    const detail = await courses.getCourse(user(member), communityId, course.slug);
    expect(detail.locked).toBe(true);
    expect(detail.modules).toEqual([]);
  });

  it("keeps the lessons of a locked course closed to a member below the level", async () => {
    const { communityId, member, course, lesson } = await lockedCourse(3);
    const actor = user(member);

    expect(
      await notFoundSubject(courses.getLesson(actor, communityId, course.slug, lesson.slug)),
    ).toBe("lesson");
    expect(await notFoundSubject(courses.markLessonComplete(actor, communityId, lesson.id))).toBe(
      "lesson",
    );
    expect(await notFoundSubject(courses.recordLessonView(actor, communityId, lesson.id))).toBe(
      "lesson",
    );
    expect(await courses.searchLessons(actor, communityId, "glaze", 10)).toEqual([]);
  });

  it("unlocks the course for a member at the required level", async () => {
    const { communityId, member, course, lesson } = await lockedCourse(3);
    await setLevel(communityId, member, 3);
    const actor = user(member);

    const detail = await courses.getCourse(actor, communityId, course.slug);
    expect(detail.locked).toBe(false);
    expect(detail.modules[0]?.lessons).toHaveLength(1);
    expect((await courses.getLesson(actor, communityId, course.slug, lesson.slug)).id).toBe(
      lesson.id,
    );
    expect(await courses.searchLessons(actor, communityId, "glaze", 10)).toHaveLength(1);
  });

  it.each(["moderator", "admin"] as const)(
    "lets a %s at level 1 open a locked course",
    async (role) => {
      const { communityId, course, lesson } = await lockedCourse(9);
      const staff = await insertMember(db, communityId, role);

      expect((await courses.getCourse(user(staff), communityId, course.slug)).locked).toBe(false);
      expect((await courses.getLesson(user(staff), communityId, course.slug, lesson.slug)).id).toBe(
        lesson.id,
      );
    },
  );

  it("ignores the required level while levels are turned off", async () => {
    const { communityId, member, course } = await lockedCourse(5);
    await db
      .update(communities)
      .set({ gamificationEnabled: false })
      .where(eq(communities.id, communityId));

    const detail = await courses.getCourse(user(member), communityId, course.slug);
    expect(detail).toMatchObject({ locked: false, requiredLevel: null });
  });

  it("uses the member's level in this community, not one earned elsewhere", async () => {
    const { communityId, member, course } = await lockedCourse(3);
    const elsewhere = await insertCommunity(db);
    await setLevel(elsewhere, member, 9);

    expect((await courses.getCourse(user(member), communityId, course.slug)).locked).toBe(true);
  });
});
