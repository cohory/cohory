import { assertCan, type Actor } from "@cohory/authz";

import { CommentNotFoundError, PostNotFoundError } from "../errors";
import { isLivePost } from "./live";
import type { PostEvent, ReactionSubject } from "../events";
import type { PostsStore } from "../repository";
import type { LikeState } from "../views";
import {
  isUuid,
  recordEvents,
  requireUserId,
  withWriteAccess,
  type Recorded,
  type Runtime,
} from "./context";

export interface ToggleLikeInput {
  readonly subjectType: ReactionSubject;
  readonly subjectId: string;
  readonly liked: boolean;
}

export interface ToggleLikeResult extends LikeState, Recorded {}

interface LikedSubject {
  readonly authorId: string;
  readonly postId: string;
}

async function likedSubject(
  store: PostsStore,
  subjectType: ReactionSubject,
  subjectId: string,
): Promise<LikedSubject> {
  if (!isUuid(subjectId)) {
    throw subjectType === "post" ? new PostNotFoundError() : new CommentNotFoundError();
  }
  if (subjectType === "post") {
    const post = await store.findPost(subjectId);
    if (!isLivePost(post)) {
      throw new PostNotFoundError();
    }
    return { authorId: post.authorId, postId: post.id };
  }
  const comment = await store.findComment(subjectId);
  const post = comment ? await store.findPost(comment.postId) : null;
  if (!comment || comment.deletedAt || !isLivePost(post)) {
    throw new CommentNotFoundError();
  }
  return { authorId: comment.authorId, postId: comment.postId };
}

export function createLikeOperations(runtime: Runtime) {
  return {
    async toggleLike(
      actor: Actor,
      communityId: string,
      input: ToggleLikeInput,
    ): Promise<ToggleLikeResult> {
      const userId = requireUserId(actor);
      runtime.rateLimit("reaction", userId);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const { subjectType, subjectId, liked } = input;
        assertCan(actor, "like", subjectType, access.policy());
        const { authorId, postId } = await likedSubject(access.store, subjectType, subjectId);
        const target = { subjectType, subjectId };
        const reactionId = liked
          ? await access.store.addReaction(target, userId, authorId)
          : await access.store.removeReaction(target, userId);
        const likeCount = reactionId
          ? await access.store.adjustLikeCount(target, liked ? 1 : -1)
          : await access.store.readLikeCount(target);
        const events: PostEvent[] = reactionId
          ? [
              {
                type: liked ? "like.added" : "like.removed",
                payload: {
                  communityId: access.community.id,
                  reactionId,
                  subjectType,
                  subjectId,
                  postId,
                  subjectAuthorId: authorId,
                  userId,
                  occurredAt: runtime.now().toISOString(),
                },
              },
            ]
          : [];
        return recordEvents(runtime, access, { liked, likeCount, events });
      });
    },
  };
}
