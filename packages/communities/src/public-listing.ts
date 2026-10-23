import { getDb, type Database } from "@cohory/db";
import { communities } from "@cohory/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export interface PublicCommunityEntry {
  readonly slug: string;
  readonly updatedAt: Date;
}

// A sitemap file holds at most 50,000 URLs.
export const publicListingLimit = 49_000;

export async function listPublicCommunities(
  db: Database = getDb(),
): Promise<PublicCommunityEntry[]> {
  return db
    .select({ slug: communities.slug, updatedAt: communities.updatedAt })
    .from(communities)
    .where(
      and(
        eq(communities.privacy, "public"),
        isNull(communities.archivedAt),
        isNull(communities.deletedAt),
      ),
    )
    .orderBy(desc(communities.updatedAt))
    .limit(publicListingLimit);
}
