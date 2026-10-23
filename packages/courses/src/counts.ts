import { runInCommunity, withCommunity, type CommunityId, type Database } from "@cohory/db";
import { courses } from "@cohory/db/schema";
import { count, eq } from "drizzle-orm";

export function countPublishedCourses(db: Database, communityId: CommunityId): Promise<number> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const [row] = await tx
      .select({ value: count() })
      .from(courses)
      .where(where(courses, eq(courses.status, "published")));
    return row?.value ?? 0;
  });
}
