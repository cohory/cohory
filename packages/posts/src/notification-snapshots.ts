import { parseCommunityId, runInCommunity, withCommunity, type Database } from "@cohory/db";
import { comments, posts } from "@cohory/db/schema";
import { inArray, isNull } from "drizzle-orm";

export interface NotificationPostSnapshots {
  readonly titles: ReadonlyMap<string, string | null>;
  readonly liveComments: ReadonlySet<string>;
}

// Notification emails are sent minutes after the event, so they ask what is still visible
// right before sending. A post or comment missing from the result has been removed.
export async function getPostSnapshotsForNotification(
  db: Database,
  input: {
    readonly communityId: string;
    readonly postIds: readonly string[];
    readonly commentIds: readonly string[];
  },
): Promise<NotificationPostSnapshots> {
  if (input.postIds.length === 0 && input.commentIds.length === 0) {
    return { titles: new Map(), liveComments: new Set() };
  }
  const scope = withCommunity(db, parseCommunityId(input.communityId));
  return runInCommunity(scope, async ({ tx, where }) => {
    const livePosts =
      input.postIds.length > 0
        ? await tx
            .select({ id: posts.id, title: posts.title })
            .from(posts)
            .where(where(posts, inArray(posts.id, [...input.postIds]), isNull(posts.deletedAt)))
        : [];
    const liveComments =
      input.commentIds.length > 0
        ? await tx
            .select({ id: comments.id })
            .from(comments)
            .where(
              where(
                comments,
                inArray(comments.id, [...input.commentIds]),
                isNull(comments.deletedAt),
              ),
            )
        : [];
    return {
      titles: new Map(livePosts.map((post) => [post.id, post.title])),
      liveComments: new Set(liveComments.map((comment) => comment.id)),
    };
  });
}
