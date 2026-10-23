import {
  createDb,
  createPool,
  getCommunityBySlug,
  parseAdminDatabaseEnv,
  type CommunitySlug,
} from "@cohory/db";
import { categories, posts } from "@cohory/db/schema";
import { devPaidSeed, devSeed, seedDevData } from "@cohory/db/seed";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { seedDevPaidPosts, seedDevPosts } from "./seed";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);

afterAll(async () => {
  await pool.end();
});

async function seeded(slug: CommunitySlug) {
  const community = await getCommunityBySlug(db, slug);
  const communityId = community?.id ?? "";
  const categoryRows = await db
    .select({ name: categories.name, staffOnly: categories.staffOnly })
    .from(categories)
    .where(eq(categories.communityId, communityId))
    .orderBy(categories.position);
  const pinned = await db
    .select({ title: posts.title })
    .from(posts)
    .where(and(eq(posts.communityId, communityId), isNotNull(posts.pinnedAt)));
  const all = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.communityId, communityId));
  return { categoryRows, pinned: pinned.map((row) => row.title).sort(), count: all.length };
}

describe("posts dev seed", () => {
  it("writes the Cohory Creators categories, pinned welcome and roadmap posts, and member posts, once", async () => {
    await seedDevData(db);

    await seedDevPosts(db);
    const again = await seedDevPosts(db);

    const result = await seeded(devSeed.communitySlug);
    expect(again).toEqual({ categoriesCreated: 0, postsCreated: 0, commentsCreated: 0 });
    expect(result.categoryRows).toEqual([
      { name: "Introductions", staffOnly: false },
      { name: "Ideas and feedback", staffOnly: false },
      { name: "Questions", staffOnly: false },
      { name: "Wins", staffOnly: false },
      { name: "Announcements", staffOnly: true },
      { name: "Bugs", staffOnly: false },
    ]);
    expect(result.pinned).toEqual([
      "Roadmap: now, next, later",
      "Welcome to Cohory Creators: how to give feedback",
    ]);
    expect(result.count).toBeGreaterThanOrEqual(8);
  });

  it("writes one pinned welcome post and three categories in Cohory Pro, once", async () => {
    await seedDevData(db);

    await seedDevPaidPosts(db);
    const again = await seedDevPaidPosts(db);

    const result = await seeded(devPaidSeed.communitySlug);
    expect(again).toEqual({ categoriesCreated: 0, postsCreated: 0, commentsCreated: 0 });
    expect(result.categoryRows.map((row) => row.name)).toEqual([
      "General",
      "Wins",
      "Announcements",
    ]);
    expect(result.pinned).toEqual(["Welcome to Cohory Pro"]);
    expect(result.count).toBe(1);
  });
});
