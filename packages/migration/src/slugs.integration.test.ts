import { communitySlugSchema, createCommunityWithOwner, newId } from "@cohory/db";
import { courses, events, lessons, users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readArchive, writeArchive } from "./format/archive";
import { restoreArchive } from "./import/restore";
import {
  currentDatabaseName,
  openDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";
import { emptyArchiveRecords } from "./test/records";

let database: TestDatabase;
let files: TempStorage;
const stamp = "2026-10-01T00:00:00.000Z";

beforeAll(async () => {
  database = await openDatabase(currentDatabaseName());
  files = await tempStorage();
});

afterAll(async () => {
  await database.close();
  await files.remove();
});

function archiveWithSlugs() {
  const sourceCommunity = newId();
  const courseId = newId();
  const moduleId = newId();
  const records = {
    ...emptyArchiveRecords(sourceCommunity),
    courses: [
      {
        id: courseId,
        slug: "Intro To Go!",
        title: "Intro to Go",
        description: null,
        coverKey: null,
        status: "published" as const,
        position: 0,
        access: "all_members" as const,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    course_modules: [{ id: moduleId, courseId, title: "Basics", position: 0 }],
    lessons: ["Lesson_One", "lesson-one", "new"].map((slug, position) => ({
      id: newId(),
      courseId,
      moduleId,
      slug,
      title: `Lesson ${position}`,
      bodyMarkdown: null,
      videoUrl: null,
      attachments: [],
      status: "published" as const,
      position,
      createdAt: stamp,
      updatedAt: stamp,
    })),
    events: [
      {
        id: newId(),
        slug: "Launch Party",
        title: "Launch party",
        description: null,
        startsAtLocal: "2026-11-01T18:00",
        timeZone: "UTC",
        durationMinutes: 60,
        recurrence: null,
        recurrenceUntil: null,
        location: null,
        recordingUrl: null,
        createdAt: stamp,
      },
    ],
  };
  const bytes = writeArchive({
    meta: {
      edition: "community",
      exportedAt: new Date(stamp),
      community: { id: sourceCommunity, slug: "makers", name: "Makers" },
      missingUploads: [],
    },
    records,
    uploads: new Map(),
  });
  return readArchive(bytes, { maxBytes: 10 * 1024 * 1024, maxUploadBytes: 1024 * 1024 });
}

describe("slugs on import", () => {
  it("normalizes course, lesson, and event slugs like new ones and reports each change", async () => {
    const [owner] = await database.admin
      .insert(users)
      .values({ email: `slug-owner-${newId().slice(-8)}@slugs.test`, name: "Owner" })
      .returning({ id: users.id });
    if (!owner) throw new Error("no owner");
    const created = await createCommunityWithOwner(database.admin, {
      ownerUserId: owner.id,
      slug: communitySlugSchema.parse(`slugs-${newId().slice(-10)}`),
      name: "Slugs",
    });
    if (created.kind !== "created") throw new Error("slug taken");
    const communityId = created.community.id;
    const { runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const job = await runtime.jobs.create(communityId, {
      kind: "import",
      status: "running",
      requestedBy: owner.id,
    });

    const summary = await restoreArchive(
      { db: database.probe, storage: files.driver, now: () => new Date(), edition: "community" },
      { jobId: job.id, communityId, ownerUserId: owner.id, archive: archiveWithSlugs() },
    );

    const courseRows = await database.admin
      .select({ slug: courses.slug })
      .from(courses)
      .where(eq(courses.communityId, communityId));
    const lessonRows = await database.admin
      .select({ slug: lessons.slug, position: lessons.position })
      .from(lessons)
      .where(eq(lessons.communityId, communityId));
    const eventRows = await database.admin
      .select({ slug: events.slug })
      .from(events)
      .where(eq(events.communityId, communityId));
    expect(courseRows.map((row) => row.slug)).toEqual(["intro-to-go"]);
    expect(lessonRows.sort((a, b) => a.position - b.position).map((row) => row.slug)).toEqual([
      "lesson-one-2",
      "lesson-one",
      "new-2",
    ]);
    expect(eventRows.map((row) => row.slug)).toEqual(["launch-party"]);
    expect(summary.renamedSlugs).toEqual([
      { entity: "course", from: "Intro To Go!", to: "intro-to-go" },
      { entity: "lesson", from: "Lesson_One", to: "lesson-one-2" },
      { entity: "lesson", from: "new", to: "new-2" },
      { entity: "event", from: "Launch Party", to: "launch-party" },
    ]);
  });
});
