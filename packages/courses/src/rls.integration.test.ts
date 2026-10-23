import { newId, setRlsValue, type CommunityId, type Database } from "@cohory/db";
import {
  courseAgentVersions,
  courses as coursesTable,
  lessonAgentLayers,
  lessonProgress,
  lessons,
} from "@cohory/db/schema";
import { migrationLockKey } from "@cohory/db/migrations";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CourseNotFoundError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { validLayer } from "./test/agent-layers";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const probeRole = "cohory_courses_probe";
const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function asProbe<T>(
  settings: { community?: string; user?: string; manager?: boolean },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return probe.db.transaction(async (tx) => {
    if (settings.community) {
      await setRlsValue(tx, "community_id", settings.community);
    }
    if (settings.user) {
      await setRlsValue(tx, "user_id", settings.user);
    }
    if (settings.manager) {
      await tx.execute(sql`select set_config('app.course_manager', 'on', true)`);
    }
    return fn(tx);
  });
}

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
    await tx.execute(
      sql.raw(
        `grant select, insert, update, delete on all tables in schema public to ${probeRole}`,
      ),
    );
  });
  probe = openTestDb({ role: probeRole });
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("courses row level security", () => {
  it("is enabled and forced on every course table", async () => {
    const result = await admin.db.execute<{ relname: string; enabled: boolean; forced: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname in ('courses', 'course_modules', 'lessons', 'lesson_progress')
          order by relname`,
    );

    expect(result.rows).toEqual(
      ["course_modules", "courses", "lesson_progress", "lessons"].map((relname) => ({
        relname,
        enabled: true,
        forced: true,
      })),
    );
  });

  it("runs the courses service through a role without bypass", async () => {
    const communityId: CommunityId = await insertCommunity(admin.db);
    const owner = await insertMember(admin.db, communityId, "owner");
    const member = await insertMember(admin.db, communityId, "member");
    const other = await insertMember(admin.db, communityId, "member");
    const service = createCoursesService({
      repo: createPostgresCoursesRepository(probe.db),
      storage: memoryStorage(),
    });
    const creator = user(owner);

    const course = await service.createCourse(creator, communityId, { title: "Under RLS" });
    const module = await service.createModule(creator, communityId, course.slug, { title: "M" });
    const published = await service.createLesson(creator, communityId, course.slug, module.id, {
      title: "Open",
    });
    const draft = await service.createLesson(creator, communityId, course.slug, module.id, {
      title: "Hidden",
    });
    await service.publishLesson(creator, communityId, published.id);
    await expect(service.getCourse(user(member), communityId, course.slug)).rejects.toBeInstanceOf(
      CourseNotFoundError,
    );
    await service.publishCourse(creator, communityId, course.slug);
    const progress = await service.markLessonComplete(user(member), communityId, published.id);
    const outline = await service.getCourse(user(member), communityId, course.slug);
    const theirs = await service.listCourses(user(other), communityId);

    expect(progress.progressPercent).toBe(100);
    expect(outline.modules[0]?.lessons.map((l) => l.id)).toEqual([published.id]);
    expect(theirs[0]?.progressPercent).toBe(0);
    await expect(
      service.getLesson(user(member), communityId, course.slug, draft.slug),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
    expect(await service.deleteCourse(creator, communityId, course.slug)).toEqual({
      outcome: "archived",
    });

    const visible = await asProbe({ community: communityId }, (tx) =>
      tx.select({ id: coursesTable.id }).from(coursesTable),
    );
    const managed = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.select({ id: coursesTable.id }).from(coursesTable),
    );
    const ownRows = await asProbe({ community: communityId, user: member }, (tx) =>
      tx.select({ userId: lessonProgress.userId }).from(lessonProgress),
    );
    const otherRows = await asProbe({ community: communityId, user: other }, (tx) =>
      tx.select({ userId: lessonProgress.userId }).from(lessonProgress),
    );
    const unscoped = await asProbe({ manager: true }, (tx) =>
      tx.select({ id: lessons.id }).from(lessons),
    );

    expect(visible).toEqual([]);
    expect(managed.map((row) => row.id)).toEqual([course.id]);
    expect(ownRows).toEqual([{ userId: member }]);
    expect(otherRows).toEqual([]);
    expect(unscoped).toEqual([]);
  });

  it("refuses writes without the manager setting and progress for another user", async () => {
    const communityId = await insertCommunity(admin.db);
    const member = await insertMember(admin.db, communityId, "member");
    const other = await insertMember(admin.db, communityId, "member");
    const service = createCoursesService({
      repo: createPostgresCoursesRepository(admin.db),
      storage: memoryStorage(),
    });
    const owner = await insertMember(admin.db, communityId, "owner");
    const course = await service.createCourse(user(owner), communityId, { title: "Writes" });
    const module = await service.createModule(user(owner), communityId, course.slug, {
      title: "M",
    });
    const lesson = await service.createLesson(user(owner), communityId, course.slug, module.id, {
      title: "L",
    });

    await expect(
      asProbe({ community: communityId, user: member }, (tx) =>
        tx.insert(coursesTable).values({
          id: newId(),
          communityId,
          slug: "sneaky",
          title: "Sneaky",
          position: 1,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      asProbe({ community: communityId, user: member }, (tx) =>
        tx.insert(lessonProgress).values({
          communityId,
          lessonId: lesson.id,
          courseId: course.id,
          userId: other,
          lastViewedAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("forces row level security on the agent material tables", async () => {
    const result = await admin.db.execute<{ relname: string; enabled: boolean; forced: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname in ('lesson_agent_layers', 'course_agent_versions') order by relname`,
    );
    expect(result.rows).toEqual(
      ["course_agent_versions", "lesson_agent_layers"].map((relname) => ({
        relname,
        enabled: true,
        forced: true,
      })),
    );
  });

  it("scopes agent drafts to managers and versions to the community, with no updates", async () => {
    const communityId = await insertCommunity(admin.db);
    const otherCommunity = await insertCommunity(admin.db);
    const owner = await insertMember(admin.db, communityId, "owner");
    const member = await insertMember(admin.db, communityId, "member");
    const storage = memoryStorage();
    const service = createCoursesService({
      repo: createPostgresCoursesRepository(probe.db),
      storage,
    });
    const creator = user(owner);
    const course = await service.createCourse(creator, communityId, { title: "Agent RLS" });
    const module = await service.createModule(creator, communityId, course.slug, { title: "M" });
    const lesson = await service.createLesson(creator, communityId, course.slug, module.id, {
      title: "L",
    });
    await service.publishLesson(creator, communityId, lesson.id);
    await service.publishCourse(creator, communityId, course.slug);
    await service.saveLessonAgentLayer(
      creator,
      communityId,
      lesson.id,
      validLayer({ references: [] }),
    );
    const version = await service.publishAgentVersion(creator, communityId, course.slug, {
      bump: "major",
      license: { id: "personal-agent-use", text: "" },
    });
    const material = await service.getAgentMaterial(user(member), communityId, course.id);
    expect(material.manifest.version).toBe("1.0.0");

    const memberDrafts = await asProbe({ community: communityId, user: member }, (tx) =>
      tx.select().from(lessonAgentLayers),
    );
    const managerDrafts = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.select({ id: lessonAgentLayers.lessonId }).from(lessonAgentLayers),
    );
    const foreignVersions = await asProbe({ community: otherCommunity, manager: true }, (tx) =>
      tx.select().from(courseAgentVersions),
    );
    const updated = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx
        .update(courseAgentVersions)
        .set({ changelog: "changed" })
        .returning({ id: courseAgentVersions.id }),
    );

    expect(memberDrafts).toEqual([]);
    expect(managerDrafts).toEqual([{ id: lesson.id }]);
    expect(foreignVersions).toEqual([]);
    expect(updated).toEqual([]);
    await expect(
      asProbe({ community: communityId, user: member }, (tx) =>
        tx.insert(courseAgentVersions).values({
          communityId,
          courseId: course.id,
          version: "9.0.0",
          major: 9,
          minor: 0,
          patch: 0,
          snapshot: {},
          checksum: version.checksum,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
