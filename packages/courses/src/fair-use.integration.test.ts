import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createCommunityUploadGuard,
  createPostgresCommunitiesRepository,
} from "@cohory/communities/fair-use";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { createLocalDriver } from "@cohory/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService, type CoursesService } from "./service";
import { insertCommunity, insertMember, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
let root: string;
let courses: CoursesService;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cohory-fair-use-"));
  const storage = createLocalDriver({ root });
  courses = createCoursesService({
    repo: createPostgresCoursesRepository(db),
    storage,
    uploadGuard: createCommunityUploadGuard({
      config: parseFairUseEnv({ FAIR_USE_STORAGE_BYTES: "30", FAIR_USE_UPLOAD_BYTES: "20" }),
      repo: createPostgresCommunitiesRepository(db),
      storage,
    }),
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await close();
});

function text(size: number, name = "notes.txt") {
  return { bytes: new TextEncoder().encode("a".repeat(size)), name, declaredType: "text/plain" };
}

describe("fair use at lesson attachment upload", () => {
  it("stores files until the community's storage is used up, then refuses", async () => {
    const communityId = await insertCommunity(db);
    const admin = user(await insertMember(db, communityId, "admin"));
    const course = await courses.createCourse(admin, communityId, { title: "Glazes" });

    await courses.uploadLessonAttachment(admin, communityId, course.id, text(20));
    await courses.uploadLessonAttachment(admin, communityId, course.id, text(10));
    const error = await courses
      .uploadLessonAttachment(admin, communityId, course.id, text(1))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "storage", limit: 30, used: 30 });
  });

  it("refuses a single file above the upload limit without counting it", async () => {
    const communityId = await insertCommunity(db);
    const admin = user(await insertMember(db, communityId, "admin"));
    const course = await courses.createCourse(admin, communityId, { title: "Kilns" });

    await expect(
      courses.uploadLessonAttachment(admin, communityId, course.id, text(21)),
    ).rejects.toMatchObject({ resource: "upload", limit: 20 });
    await expect(
      courses.uploadLessonAttachment(admin, communityId, course.id, text(20)),
    ).resolves.toMatchObject({ size: 20 });
  });
});
