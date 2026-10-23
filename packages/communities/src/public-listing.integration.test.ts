import { createDb, createPool, newId, parseAdminDatabaseEnv } from "@cohory/db";
import { communities } from "@cohory/db/schema";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { listPublicCommunities } from "./public-listing";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const created: string[] = [];

async function community(
  prefix: string,
  values: Partial<typeof communities.$inferInsert> = {},
): Promise<string> {
  const slug = `${prefix}-${newId().slice(-12)}`;
  await db.insert(communities).values({ slug, name: prefix, ...values });
  created.push(slug);
  return slug;
}

afterAll(async () => {
  await db.delete(communities).where(inArray(communities.slug, created));
  await pool.end();
});

describe("listPublicCommunities", () => {
  it("lists public communities and never private, archived, or deleted ones", async () => {
    const open = await community("listed", { privacy: "public" });
    const hidden = await community("hidden", { privacy: "private" });
    const archived = await community("archived", { privacy: "public", archivedAt: new Date() });
    const deleted = await community("deleted", { privacy: "public", deletedAt: new Date() });

    const slugs = (await listPublicCommunities(db)).map((entry) => entry.slug);

    expect(slugs).toContain(open);
    expect(slugs).not.toContain(hidden);
    expect(slugs).not.toContain(archived);
    expect(slugs).not.toContain(deleted);
  });

  it("returns when each community last changed", async () => {
    const slug = await community("dated", { privacy: "public" });

    const entry = (await listPublicCommunities(db)).find((row) => row.slug === slug);

    expect(entry?.updatedAt).toBeInstanceOf(Date);
  });
});
