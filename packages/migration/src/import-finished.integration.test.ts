import { communitySlugSchema, createCommunityWithOwner, newId, type Database } from "@cohory/db";
import { memberships, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationImportFinishedJob } from "./jobs";
import { runImportFinishedJob, runMembersImportJob } from "./runner";
import { createMigrationService } from "./service";
import {
  currentDatabaseName,
  openDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";

let database: TestDatabase;
let files: TempStorage;
const suffix = newId().slice(-8);
const email = (name: string) => `${name}-${suffix}@finished.test`;

beforeAll(async () => {
  database = await openDatabase(currentDatabaseName());
  files = await tempStorage();
});

afterAll(async () => {
  await database.close();
  await files.remove();
});

async function addUser(db: Database, address: string, name: string): Promise<string> {
  const [row] = await db.insert(users).values({ email: address, name }).returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

async function finishedImport(ownerName: string) {
  const ownerId = await addUser(database.admin, email(ownerName), "Owner");
  const created = await createCommunityWithOwner(database.admin, {
    ownerUserId: ownerId,
    slug: communitySlugSchema.parse(`done-${newId().slice(-12)}`),
    name: "Done Club",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  const communityId = created.community.id;
  const test = testRuntime(database.probe, { archives: files.driver, content: files.driver });
  const service = createMigrationService(test.deps);
  const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
  const job = await service.previewMembersCsv(actor, communityId, {
    name: "members.csv",
    bytes: new TextEncoder().encode(`email,name\n${email(`${ownerName}-member`)},Member`),
  });
  await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add", notify: false });
  const payload = { jobId: job.id, communityId };
  expect(await runImportFinishedJob(test.runtime, payload)).toBe("skipped");
  await runMembersImportJob(test.runtime, payload);
  return { ...test, ownerId, communityId, slug: created.community.slug, payload };
}

describe("import finished email", () => {
  it("emails the owner once, with a link to the report and only ids in the job", async () => {
    const { runtime, mailer, queue, slug, payload } = await finishedImport("owner-done");

    const finished = queue.sent.filter((sent) => sent.name === migrationImportFinishedJob);
    expect(finished.map((sent) => sent.payload)).toEqual([payload]);
    expect(await runImportFinishedJob(runtime, payload)).toBe("succeeded");
    expect(await runImportFinishedJob(runtime, payload)).toBe("skipped");
    const owner = mailer.sent.filter((mail) => mail.template === "migration-import-finished");
    expect(owner.map((mail) => mail.to)).toEqual([email("owner-done")]);
    expect(owner[0]?.text).toContain(
      `https://new.example.test/api/v1/communities/${slug}/manage/migration/jobs/${payload.jobId}/report`,
    );
    expect(owner[0]?.text).toContain("Members CSV");
  });

  it("sends one email when two workers run the job at the same time", async () => {
    const { runtime, mailer, payload } = await finishedImport("owner-race");

    await Promise.all([
      runImportFinishedJob(runtime, payload),
      runImportFinishedJob(runtime, payload),
      runImportFinishedJob(runtime, payload),
    ]);

    const owner = mailer.sent.filter((mail) => mail.template === "migration-import-finished");
    expect(owner).toHaveLength(1);
  });

  it("emails the current owner when ownership moved after the import", async () => {
    const { runtime, mailer, ownerId, communityId, payload } = await finishedImport("owner-old");
    const newOwner = await addUser(database.admin, email("owner-new"), "New Owner");
    await database.admin
      .update(memberships)
      .set({ role: "admin" })
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, ownerId)));
    await database.admin.insert(memberships).values({
      communityId,
      userId: newOwner,
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    });

    expect(await runImportFinishedJob(runtime, payload)).toBe("succeeded");

    const owner = mailer.sent.filter((mail) => mail.template === "migration-import-finished");
    expect(owner.map((mail) => mail.to)).toEqual([email("owner-new")]);
  });
});
