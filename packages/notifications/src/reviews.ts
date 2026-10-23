import {
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
} from "@cohory/db";
import { memberships, notifications } from "@cohory/db/schema";
import { and, eq, ne } from "drizzle-orm";

export interface ReviewNotice {
  readonly communityId: string;
  readonly reviewId: string;
  readonly authorId: string;
}

export type ReviewNotifier = (notice: ReviewNotice) => Promise<number>;

export interface ReviewNotifierDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export function createReviewNotifier(deps: ReviewNotifierDeps): ReviewNotifier {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;

  return (notice) =>
    runInCommunity(
      withCommunity(deps.db, parseCommunityId(notice.communityId)),
      async ({ tx, where, values }) => {
        const owners = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            where(
              memberships,
              and(
                eq(memberships.status, "active"),
                eq(memberships.role, "owner"),
                ne(memberships.userId, notice.authorId),
              ),
            ),
          );
        if (owners.length === 0) {
          return 0;
        }
        const createdAt = now();
        const result = await tx
          .insert(notifications)
          .values(
            owners.map((owner) =>
              values({
                id: makeId(),
                userId: owner.userId,
                actorId: notice.authorId,
                type: "review_created" as const,
                subjectType: "review" as const,
                subjectId: notice.reviewId,
                postId: null,
                createdAt,
              }),
            ),
          )
          .onConflictDoNothing();
        return result.rowCount ?? 0;
      },
    );
}

let defaultNotifier: ReviewNotifier | undefined;

export function getReviewNotifier(): ReviewNotifier {
  defaultNotifier ??= createReviewNotifier({ db: getDb() });
  return defaultNotifier;
}
