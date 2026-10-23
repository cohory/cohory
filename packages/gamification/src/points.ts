import type { PointsReason } from "@cohory/db/schema";
import type { PostEvent, RemovedLike } from "@cohory/posts";

export const reactionSource = "reaction";

export interface PointEntry {
  readonly communityId: string;
  readonly userId: string;
  readonly delta: number;
  readonly reason: PointsReason;
  readonly sourceType: typeof reactionSource;
  readonly sourceId: string;
  readonly occurredAt: Date;
}

function reversals(
  communityId: string,
  likes: readonly RemovedLike[],
  reason: PointsReason,
  occurredAt: string,
): PointEntry[] {
  return likes
    .filter((like) => like.userId !== like.subjectAuthorId)
    .map((like) => ({
      communityId,
      userId: like.subjectAuthorId,
      delta: -1,
      reason,
      sourceType: reactionSource,
      sourceId: like.reactionId,
      occurredAt: new Date(occurredAt),
    }));
}

function entriesFor(event: PostEvent): PointEntry[] {
  switch (event.type) {
    case "like.added":
    case "like.removed": {
      const p = event.payload;
      if (p.userId === p.subjectAuthorId) {
        return [];
      }
      const added = event.type === "like.added";
      return [
        {
          communityId: p.communityId,
          userId: p.subjectAuthorId,
          delta: added ? 1 : -1,
          reason: added ? "like_received" : "like_removed",
          sourceType: reactionSource,
          sourceId: p.reactionId,
          occurredAt: new Date(p.occurredAt),
        },
      ];
    }
    case "post.deleted":
      return reversals(
        event.payload.communityId,
        event.payload.likes,
        "post_deleted",
        event.payload.occurredAt,
      );
    case "comment.deleted":
      return reversals(
        event.payload.communityId,
        event.payload.likes,
        "comment_deleted",
        event.payload.occurredAt,
      );
    case "post.created":
    case "post.emailed":
    case "comment.created":
    case "mention.created":
    case "report.created":
    case "report.resolved":
      return [];
  }
}

export function pointEntriesFor(events: readonly PostEvent[]): PointEntry[] {
  return events.flatMap(entriesFor);
}
