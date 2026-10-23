import type { Database } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lessonCompletionsBetween } from "./completions";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const probeRole = "cohory_courses_completions_probe";
const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
let clock = new Date("2026-10-22T10:00:00.000Z");
const courses = createCoursesService({
  repo: createPostgresCoursesRepository(admin.db),
  storage: memoryStorage(),
  now: () => clock,
});

beforeAll(async () => {
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
      end $$`),
    );
    await tx.execute(sql.raw(`grant usage on schema public to ${probeRole}`));
    await tx.execute(sql.raw(`grant select on lesson_progress to ${probeRole}`));
  });
  probe = openTestDb({ role: probeRole });
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function courseWithLessons() {
  const communityId = await insertCommunity(admin.db);
  const owner = user(await insertMember(admin.db, communityId, "owner"));
  const course = await courses.createCourse(owner, communityId, { title: "Wheel basics" });
  const module = await courses.createModule(owner, communityId, course.slug, { title: "Start" });
  const lessons = [];
  for (const title of ["Centering", "Opening"]) {
    const lesson = await courses.createLesson(owner, communityId, course.slug, module.id, {
      title,
    });
    await courses.publishLesson(owner, communityId, lesson.id);
    lessons.push(lesson);
  }
  await courses.publishCourse(owner, communityId, course.slug);
  return { communityId, lessons };
}

describe("lessonCompletionsBetween", () => {
  it("lists lessons finished inside the window, not viewed or unfinished ones", async () => {
    const { communityId, lessons } = await courseWithLessons();
    const [first, second] = lessons;
    if (!first || !second) throw new Error("expected two lessons");
    const learner = await insertMember(admin.db, communityId);
    const start = clock;
    clock = new Date(start.getTime() + 60_000);
    await courses.markLessonComplete(user(learner), communityId, first.id);
    await courses.recordLessonView(user(learner), communityId, second.id);

    const done = await lessonCompletionsBetween(
      probe.db,
      communityId,
      start,
      new Date(clock.getTime() + 1),
    );

    expect(done).toEqual([{ userId: learner, lessonId: first.id, completedAt: clock }]);
    expect(await lessonCompletionsBetween(probe.db, communityId, clock, clock)).toEqual([]);
  });

  it("reads only the given community", async () => {
    const { communityId, lessons } = await courseWithLessons();
    const other = await insertCommunity(admin.db);
    const learner = await insertMember(admin.db, communityId);
    const [first] = lessons;
    if (!first) throw new Error("expected a lesson");
    await courses.markLessonComplete(user(learner), communityId, first.id);

    expect(
      await lessonCompletionsBetween(probe.db, other, new Date(0), new Date(clock.getTime() + 1)),
    ).toEqual([]);
  });
});
