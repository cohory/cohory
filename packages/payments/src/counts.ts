import { runInCommunity, withCommunity, type CommunityId, type Database } from "@cohory/db";
import { subscriptions } from "@cohory/db/schema";
import { count, ne } from "drizzle-orm";

export function countActivatedSubscriptions(
  db: Database,
  communityId: CommunityId,
): Promise<number> {
  return runInCommunity(
    withCommunity(db, communityId),
    async ({ tx, where }) => {
      const [row] = await tx
        .select({ value: count() })
        .from(subscriptions)
        .where(where(subscriptions, ne(subscriptions.accessState, "none")));
      return row?.value ?? 0;
    },
    { flags: ["payments_manager"] },
  );
}
