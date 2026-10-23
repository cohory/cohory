import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devSeed } from "@cohory/db/seed";
import { eq } from "drizzle-orm";

import { CourseNotFoundError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { devCourse, devCourseOutline } from "./seed-course";
import { createCoursesService } from "./service";

export interface CoursesSeedResult {
  coursesCreated: number;
  lessonsCreated: number;
}

export const devCourseSlug = "how-to-use-cohory-classroom";

export async function seedDevCourses(db: Database): Promise<CoursesSeedResult> {
  const community = await getCommunityBySlug(db, devSeed.communitySlug);
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, devSeed.email))
    .limit(1);
  if (!community || !owner) {
    throw new Error("run the base seed before seeding courses");
  }
  const service = createCoursesService({
    repo: createPostgresCoursesRepository(db),
    storage: {
      put: () => Promise.reject(new Error("the courses seed does not upload files")),
      get: () => Promise.reject(new Error("the courses seed does not read files")),
    },
  });
  const actor: Actor = { kind: "user", userId: owner.id, platformAdmin: false };
  try {
    await service.getCourse(actor, community.id, devCourseSlug);
    return { coursesCreated: 0, lessonsCreated: 0 };
  } catch (error: unknown) {
    if (!(error instanceof CourseNotFoundError)) {
      throw error;
    }
  }

  const course = await service.createCourse(actor, community.id, devCourse);
  if (course.slug !== devCourseSlug) {
    throw new Error(`the seeded course got the slug ${course.slug}, expected ${devCourseSlug}`);
  }
  let lessonsCreated = 0;
  for (const section of devCourseOutline) {
    const module = await service.createModule(actor, community.id, course.slug, {
      title: section.title,
    });
    for (const lesson of section.lessons) {
      const created = await service.createLesson(actor, community.id, course.slug, module.id, {
        title: lesson.title,
        bodyMarkdown: lesson.body,
        videoUrl: lesson.videoUrl ?? null,
      });
      if (!lesson.draft) {
        await service.publishLesson(actor, community.id, created.id);
      }
      lessonsCreated += 1;
    }
  }
  await service.publishCourse(actor, community.id, course.slug);
  return { coursesCreated: 1, lessonsCreated };
}
