import { communitySlugSchema, createCommunityWithOwner, newId } from "@cohory/db";
import { pointsLedger, pointsSourceTypes, users } from "@cohory/db/schema";
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

const archivedTypes = [...pointsSourceTypes, "imported_from_elsewhere", null] as const;

function archiveWithEverySourceType() {
  const sourceCommunity = newId();
  const memberId = newId();
  const records = {
    ...emptyArchiveRecords(sourceCommunity),
    users: [
      {
        id: memberId,
        email: `points-${newId().slice(-8)}@points.test`,
        name: "Points Member",
        username: null,
        emailVerified: true,
        erased: false,
        createdAt: stamp,
      },
    ],
    memberships: [
      {
        id: newId(),
        userId: memberId,
        role: "member" as const,
        status: "active" as const,
        bio: null,
        joinAnswers: null,
        bannedEmail: null,
        joinedAt: stamp,
        lastSeenAt: null,
        createdAt: stamp,
      },
    ],
    points_ledger: archivedTypes.map((sourceType) => ({
      id: newId(),
      userId: memberId,
      delta: 1,
      reason: "like_received" as const,
      sourceType,
      sourceId: sourceType === null ? null : newId(),
      occurredAt: stamp,
    })),
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

describe("points ledger on import", () => {
  it("imports every source type and clears source types the ledger does not know", async () => {
    const [owner] = await database.admin
      .insert(users)
      .values({ email: `points-owner-${newId().slice(-8)}@points.test`, name: "Owner" })
      .returning({ id: users.id });
    if (!owner) throw new Error("no owner");
    const created = await createCommunityWithOwner(database.admin, {
      ownerUserId: owner.id,
      slug: communitySlugSchema.parse(`points-${newId().slice(-10)}`),
      name: "Points",
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

    await restoreArchive(
      { db: database.probe, storage: files.driver, now: () => new Date(), edition: "community" },
      {
        jobId: job.id,
        communityId,
        ownerUserId: owner.id,
        archive: archiveWithEverySourceType(),
      },
    );

    const rows = await database.admin
      .select({ sourceType: pointsLedger.sourceType, sourceId: pointsLedger.sourceId })
      .from(pointsLedger)
      .where(eq(pointsLedger.communityId, communityId));
    expect(rows.map((row) => row.sourceType).sort()).toEqual(
      [...pointsSourceTypes, null, null].sort(),
    );
    expect(rows.filter((row) => row.sourceType === null).map((row) => row.sourceId)).toEqual([
      null,
      null,
    ]);
  });
});
