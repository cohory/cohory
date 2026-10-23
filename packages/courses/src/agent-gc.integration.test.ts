import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalDriver, courseAgentPrefix, type StorageDriver } from "@cohory/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agentFilesGraceMs, collectAgentFileGarbage } from "./agent-gc";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { validLayer } from "./test/agent-layers";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
let root: string;
let storage: StorageDriver;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cohory-agent-gc-"));
  storage = createLocalDriver({ root, maxBytes: 1024 * 1024 });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await close();
});

function upload(courses: ReturnType<typeof createCoursesService>, actor: ReturnType<typeof user>) {
  return (communityId: string, courseId: string, text: string) =>
    courses.uploadAgentFile(actor, communityId, courseId, {
      bytes: new TextEncoder().encode(text),
      name: "notes.md",
      declaredType: "text/markdown",
    });
}

describe("agent file garbage collection", () => {
  it("deletes files no draft or version uses once they are older than the grace period", async () => {
    const courses = createCoursesService({
      repo: createPostgresCoursesRepository(db),
      storage,
      appUrl: "https://cohory.example/",
    });
    const communityId = await insertCommunity(db);
    const admin = user(await insertMember(db, communityId, "admin"));
    const course = await courses.createCourse(admin, communityId, { title: "Glazes" });
    const module = await courses.createModule(admin, communityId, course.slug, { title: "One" });
    const lesson = await courses.createLesson(admin, communityId, course.slug, module.id, {
      title: "Mixing",
      bodyMarkdown: "# Mixing\n\nWeigh everything.\n",
    });
    const put = upload(courses, admin);
    const used = await put(communityId, course.id, "# Used\n");
    const orphan = await put(communityId, course.id, "# Orphan\n");
    await courses.saveLessonAgentLayer(
      admin,
      communityId,
      lesson.id,
      validLayer({ references: [{ title: "Used", file: used }] }),
    );

    const early = await collectAgentFileGarbage({ db, storage, communityIds: [communityId] });
    expect(early.deleted).toBe(0);

    const later = await collectAgentFileGarbage({
      db,
      storage,
      communityIds: [communityId],
      now: () => new Date(Date.now() + agentFilesGraceMs + 60_000),
    });

    expect(later).toMatchObject({ courses: 1, deleted: 1 });
    const left = (await storage.list(courseAgentPrefix(communityId, course.id))).map(
      (entry) => entry.key,
    );
    expect(left).toEqual([used.key]);
    expect(left).not.toContain(orphan.key);
  });
});
