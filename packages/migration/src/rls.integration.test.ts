import {
  communitySlugSchema,
  createCommunity,
  newId,
  setRlsFlag,
  setRlsValue,
  type Database,
} from "@cohory/db";
import { migrationIdMap, migrationJobs } from "@cohory/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentDatabaseName, openDatabase, type TestDatabase } from "./test/harness";

let database: TestDatabase;
let communityId: string;
let otherCommunityId: string;
let jobId: string;

async function insertCommunity(db: Database): Promise<string> {
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`rls-${newId().slice(-12)}`),
    name: "RLS",
  });
  return community.id;
}

function asProbe<T>(
  settings: { community?: string; manager?: boolean },
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.probe.transaction(async (tx) => {
    if (settings.community) {
      await setRlsValue(tx, "community_id", settings.community);
    }
    if (settings.manager) {
      await setRlsFlag(tx, "migration_manager");
    }
    return fn(tx);
  });
}

beforeAll(async () => {
  database = await openDatabase(currentDatabaseName());
  communityId = await insertCommunity(database.admin);
  otherCommunityId = await insertCommunity(database.admin);
  const [job] = await database.admin
    .insert(migrationJobs)
    .values({ communityId, kind: "export", status: "queued" })
    .returning();
  jobId = job?.id ?? "";
  await database.admin
    .insert(migrationIdMap)
    .values({ communityId, jobId, entity: "posts", sourceId: "a", targetId: newId() });
});

afterAll(async () => {
  await database.close();
});

describe("migration tables row level security", () => {
  it("shows jobs only inside the community with the migration setting on", async () => {
    const inScope = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.select().from(migrationJobs),
    );
    const noSetting = await asProbe({ community: communityId }, (tx) =>
      tx.select().from(migrationJobs),
    );
    const otherCommunity = await asProbe({ community: otherCommunityId, manager: true }, (tx) =>
      tx.select().from(migrationJobs),
    );

    expect(inScope.map((row) => row.id)).toEqual([jobId]);
    expect(noSetting).toEqual([]);
    expect(otherCommunity).toEqual([]);
  });

  it("refuses writes into another community and hides its id map", async () => {
    await expect(
      asProbe({ community: otherCommunityId, manager: true }, (tx) =>
        tx.insert(migrationJobs).values({ communityId, kind: "import", status: "ready" }),
      ),
    ).rejects.toThrow();
    const maps = await asProbe({ community: otherCommunityId, manager: true }, (tx) =>
      tx.select().from(migrationIdMap),
    );

    expect(maps).toEqual([]);
  });
});
