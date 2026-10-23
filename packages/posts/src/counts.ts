import { runInCommunity, withCommunity, type CommunityId, type Database } from "@cohory/db";
import { posts } from "@cohory/db/schema";
import { count, isNull } from "drizzle-orm";

export function countPublishedPosts(db: Database, communityId: CommunityId): Promise<number> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const [row] = await tx
      .select({ value: count() })
      .from(posts)
      .where(where(posts, isNull(posts.deletedAt), isNull(posts.scheduledAt)));
    return row?.value ?? 0;
  });
}
