import { ForbiddenError } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import { outbox } from "@cohory/db/schema";
import { courseEventsTopic } from "@cohory/events/course-events";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { countPublishedCourses } from "./counts";
import { CourseNotFoundError, CoursesValidationError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService, type CoursesService } from "./service";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
const courses: CoursesService = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage: memoryStorage(),
});

afterAll(async () => {
  await close();
});

interface World {
  communityId: CommunityId;
  admin: string;
  member: string;
  outsider: string;
}

async function world(): Promise<World> {
  const communityId = await insertCommunity(db);
  const otherCommunity = await insertCommunity(db);
  return {
    communityId,
    admin: await insertMember(db, communityId, "admin"),
    member: await insertMember(db, communityId, "member"),
    outsider: await insertMember(db, otherCommunity, "owner"),
  };
}

async function draftCourse(w: World) {
  const admin = user(w.admin);
  const course = await courses.createCourse(admin, w.communityId, { title: "Clay basics" });
  const first = await courses.createModule(admin, w.communityId, course.slug, { title: "Week 1" });
  const second = await courses.createModule(admin, w.communityId, course.slug, { title: "Week 2" });
  return { course, first, second };
}

async function addLesson(w: World, courseSlug: string, moduleId: string, title: string) {
  return courses.createLesson(user(w.admin), w.communityId, courseSlug, moduleId, {
    title,
    bodyMarkdown: `# ${title}`,
  });
}

function titlesByModule(detail: Awaited<ReturnType<CoursesService["getCourse"]>>) {
  return detail.modules.map((module) => module.lessons.map((lesson) => lesson.title));
}

describe("publishing a course", () => {
  it("refuses to publish a course with no lesson members could see", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Still a draft");

    const attempt = courses.publishCourse(user(w.admin), w.communityId, course.slug);

    await expect(attempt).rejects.toBeInstanceOf(CoursesValidationError);
    const after = await courses.getCourse(user(w.admin), w.communityId, course.slug);
    expect(after.status).toBe("draft");
  });

  it("publishes draft lessons together with the course when asked", async () => {
    const w = await world();
    const { course, first, second } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Welcome");
    await addLesson(w, course.slug, second.id, "Throwing");

    const published = await courses.publishCourse(user(w.admin), w.communityId, course.slug, {
      publishDraftLessons: true,
    });

    expect(published.status).toBe("published");
    expect(published.publishedLessonCount).toBe(2);
    const seen = await courses.getCourse(user(w.member), w.communityId, course.slug);
    expect(titlesByModule(seen)).toEqual([["Welcome"], ["Throwing"]]);
  });

  it("records a course published event once, not when an already published course is published again", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Welcome");
    const options = { publishDraftLessons: true };

    const published = await courses.publishCourse(
      user(w.admin),
      w.communityId,
      course.slug,
      options,
    );
    await courses.publishCourse(user(w.admin), w.communityId, course.slug, options);

    const rows = await db
      .select({ payload: outbox.payload })
      .from(outbox)
      .where(and(eq(outbox.communityId, w.communityId), eq(outbox.topic, courseEventsTopic)));
    expect(rows).toEqual([
      {
        payload: {
          events: [
            {
              type: "course.published",
              payload: {
                communityId: w.communityId,
                courseId: published.id,
                occurredAt: expect.any(String),
              },
            },
          ],
        },
      },
    ]);
  });

  it("leaves draft lessons hidden when the creator publishes only the course", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    const ready = await addLesson(w, course.slug, first.id, "Ready");
    await addLesson(w, course.slug, first.id, "Not yet");
    await courses.publishLesson(user(w.admin), w.communityId, ready.id);

    const published = await courses.publishCourse(user(w.admin), w.communityId, course.slug, {
      publishDraftLessons: false,
    });

    expect(published.publishedLessonCount).toBe(1);
    const seen = await courses.getCourse(user(w.member), w.communityId, course.slug);
    expect(titlesByModule(seen)).toEqual([["Ready"], []]);
  });

  it("denies members and other communities' owners", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Welcome");

    await expect(
      courses.publishCourse(user(w.member), w.communityId, course.slug, {
        publishDraftLessons: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      courses.publishCourse(user(w.outsider), w.communityId, course.slug, {
        publishDraftLessons: true,
      }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    const after = await courses.getCourse(user(w.admin), w.communityId, course.slug);
    expect(after.status).toBe("draft");
    expect(after.publishedLessonCount).toBe(0);
  });
});

describe("the course.published event", () => {
  const publishedMatch = JSON.stringify({ events: [{ type: "course.published" }] });

  async function publishedEvents(communityId: CommunityId): Promise<number> {
    const rows = await db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.communityId, communityId),
          sql`${outbox.payload} @> ${publishedMatch}::jsonb`,
        ),
      );
    return rows.length;
  }

  it("is written exactly once, on one topic, when a course becomes published, and the count follows published courses", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Welcome");
    expect(await countPublishedCourses(db, w.communityId)).toBe(0);

    await courses.publishCourse(user(w.admin), w.communityId, course.slug, {
      publishDraftLessons: true,
    });
    await courses.updateCourse(user(w.admin), w.communityId, course.slug, { title: "Clay" });

    expect(await publishedEvents(w.communityId)).toBe(1);
    expect(await countPublishedCourses(db, w.communityId)).toBe(1);

    await courses.unpublishCourse(user(w.admin), w.communityId, course.slug);
    expect(await countPublishedCourses(db, w.communityId)).toBe(0);
  });
});

describe("moving a lesson", () => {
  it("moves a lesson into another module at the chosen position", async () => {
    const w = await world();
    const { course, first, second } = await draftCourse(w);
    const moving = await addLesson(w, course.slug, first.id, "Glazes");
    await addLesson(w, course.slug, first.id, "Wedging");
    await addLesson(w, course.slug, second.id, "Throwing");
    await addLesson(w, course.slug, second.id, "Trimming");

    const detail = await courses.moveLesson(user(w.admin), w.communityId, moving.id, {
      moduleId: second.id,
      position: 1,
    });

    expect(titlesByModule(detail)).toEqual([["Wedging"], ["Throwing", "Glazes", "Trimming"]]);
  });

  it("appends to the end of the module when no position is given", async () => {
    const w = await world();
    const { course, first, second } = await draftCourse(w);
    const moving = await addLesson(w, course.slug, first.id, "Glazes");
    await addLesson(w, course.slug, second.id, "Throwing");

    const detail = await courses.moveLesson(user(w.admin), w.communityId, moving.id, {
      moduleId: second.id,
    });

    expect(titlesByModule(detail)).toEqual([[], ["Throwing", "Glazes"]]);
  });

  it("denies members and refuses modules from another course", async () => {
    const w = await world();
    const { course, first, second } = await draftCourse(w);
    const lesson = await addLesson(w, course.slug, first.id, "Glazes");
    const other = await draftCourse(w);

    await expect(
      courses.moveLesson(user(w.member), w.communityId, lesson.id, { moduleId: second.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      courses.moveLesson(user(w.outsider), w.communityId, lesson.id, { moduleId: second.id }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    await expect(
      courses.moveLesson(user(w.admin), w.communityId, lesson.id, { moduleId: other.first.id }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });
});

describe("duplicating a lesson", () => {
  it("copies the lesson as a draft right after the original", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    const original = await addLesson(w, course.slug, first.id, "Glazes");
    await addLesson(w, course.slug, first.id, "Firing");
    await courses.publishLesson(user(w.admin), w.communityId, original.id);

    const copy = await courses.duplicateLesson(user(w.admin), w.communityId, original.id);

    expect(copy).toMatchObject({
      status: "draft",
      title: "Glazes (copy)",
      bodyMarkdown: "# Glazes",
      moduleId: first.id,
    });
    expect(copy.slug).not.toBe(original.slug);
    const detail = await courses.getCourse(user(w.admin), w.communityId, course.slug);
    expect(titlesByModule(detail)[0]).toEqual(["Glazes", "Glazes (copy)", "Firing"]);
  });

  it("denies members and other communities' owners", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    const original = await addLesson(w, course.slug, first.id, "Glazes");

    await expect(
      courses.duplicateLesson(user(w.member), w.communityId, original.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      courses.duplicateLesson(user(w.outsider), w.communityId, original.id),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });
});

describe("lesson slugs", () => {
  it("takes the slug from the new title while the lesson is a draft", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    const lesson = await addLesson(w, course.slug, first.id, "New lesson");

    const saved = await courses.updateLesson(user(w.admin), w.communityId, lesson.id, {
      title: "Pricing your community",
    });

    expect(saved.slug).toBe("pricing-your-community");
  });

  it("avoids a slug another lesson in the course already uses", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    await addLesson(w, course.slug, first.id, "Launch day");
    const lesson = await addLesson(w, course.slug, first.id, "New lesson");

    const saved = await courses.updateLesson(user(w.admin), w.communityId, lesson.id, {
      title: "Launch day",
    });

    expect(saved.slug).toBe("launch-day-2");
  });

  it("keeps the slug of a published lesson so shared links still work", async () => {
    const w = await world();
    const { course, first } = await draftCourse(w);
    const lesson = await addLesson(w, course.slug, first.id, "Welcome");
    await courses.publishLesson(user(w.admin), w.communityId, lesson.id);

    const saved = await courses.updateLesson(user(w.admin), w.communityId, lesson.id, {
      title: "Welcome and how this course works",
    });

    expect(saved.slug).toBe(lesson.slug);
  });
});
