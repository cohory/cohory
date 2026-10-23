export const postEventsTopic = "post_events";

export type ReactionSubject = "post" | "comment";

export interface RemovedLike {
  readonly reactionId: string;
  readonly subjectAuthorId: string;
  readonly userId: string;
}

interface LikeChange {
  readonly communityId: string;
  readonly reactionId: string;
  readonly subjectType: ReactionSubject;
  readonly subjectId: string;
  readonly postId?: string;
  readonly subjectAuthorId: string;
  readonly userId: string;
  readonly occurredAt: string;
}

export interface PostEvents {
  "post.created": {
    readonly communityId: string;
    readonly postId: string;
    readonly authorId: string;
    readonly agentId?: string | null;
    readonly mentionedUserIds: readonly string[];
  };
  "comment.created": {
    readonly communityId: string;
    readonly postId: string;
    readonly commentId: string;
    readonly parentId: string | null;
    readonly parentAuthorId: string | null;
    readonly authorId: string;
    readonly agentId?: string | null;
    readonly postAuthorId: string;
    readonly mentionedUserIds: readonly string[];
    readonly preview?: string;
  };
  "mention.created": {
    readonly communityId: string;
    readonly subjectType: ReactionSubject;
    readonly subjectId: string;
    readonly postId: string;
    readonly authorId: string;
    readonly mentionedUserId: string;
    readonly preview?: string;
  };
  "like.added": LikeChange;
  "like.removed": LikeChange;
  "post.deleted": {
    readonly communityId: string;
    readonly postId: string;
    readonly authorId: string;
    readonly occurredAt: string;
    readonly likes: readonly RemovedLike[];
  };
  "report.resolved": {
    readonly communityId: string;
    readonly postId: string;
    readonly commentId: string | null;
    readonly reporterIds: readonly string[];
    readonly resolution: "dismissed" | "content_removed" | "member_banned";
    readonly resolvedBy: string;
  };
  "report.created": {
    readonly communityId: string;
    readonly reportId: string;
    readonly postId: string;
    readonly commentId: string | null;
    readonly reporterId: string;
  };
  "post.emailed": {
    readonly communityId: string;
    readonly postId: string;
    readonly sentBy: string;
    readonly occurredAt: string;
  };
  "comment.deleted": {
    readonly communityId: string;
    readonly postId: string;
    readonly commentId: string;
    readonly authorId: string;
    readonly occurredAt: string;
    readonly likes: readonly RemovedLike[];
  };
}

export type PostEventName = keyof PostEvents;

export type PostEvent = {
  [K in PostEventName]: { readonly type: K; readonly payload: PostEvents[K] };
}[PostEventName];
