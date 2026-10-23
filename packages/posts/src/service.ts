import { getCommunityUploadGuard } from "@cohory/communities/fair-use";
import { getDb } from "@cohory/db";
import { getRateLimiter } from "@cohory/rate-limit";
import { getStorage } from "@cohory/storage";

import type { PostEvent } from "./events";
import { createPostgresPostsRepository } from "./postgres-repository";
import { createCategoryOperations } from "./service/categories";
import { createCommentOperations } from "./service/comments";
import { createDraftOperations } from "./service/drafts";
import { createFollowOperations } from "./service/follows";
import { createRuntime, type PostsServiceDeps, type Recorded } from "./service/context";
import { createLikeOperations } from "./service/likes";
import { createMemberEmailOperations } from "./service/member-email";
import { createPostOperations } from "./service/posts";
import { createReportOperations } from "./service/reports";
import { createScheduledOperations } from "./service/scheduled";
import { createSearchOperations } from "./service/search";

export interface CommittedPostEvents {
  readonly outboxId: string;
  readonly events: readonly PostEvent[];
}

export type PostEventsHandler = (committed: CommittedPostEvents) => Promise<void>;

export interface PostsServiceOptions extends PostsServiceDeps {
  readonly onEvents?: PostEventsHandler;
}

function afterCommit<A extends unknown[], R extends Recorded>(
  operation: (...args: A) => Promise<R>,
  onEvents: PostEventsHandler | undefined,
): (...args: A) => Promise<R> {
  if (!onEvents) {
    return operation;
  }
  return async (...args) => {
    const result = await operation(...args);
    if (result.outboxId) {
      await onEvents({ outboxId: result.outboxId, events: result.events });
    }
    return result;
  };
}

function afterCommitVoid<A extends unknown[]>(
  operation: (...args: A) => Promise<Recorded>,
  onEvents: PostEventsHandler | undefined,
): (...args: A) => Promise<void> {
  const published = afterCommit(operation, onEvents);
  return async (...args) => {
    await published(...args);
  };
}

export function createPostsService(deps: PostsServiceOptions) {
  const runtime = createRuntime(deps);
  const posts = createPostOperations(runtime);
  const comments = createCommentOperations(runtime);
  const likes = createLikeOperations(runtime);
  const drafts = createDraftOperations(runtime);
  const scheduled = createScheduledOperations(runtime);
  const memberEmail = createMemberEmailOperations(runtime);
  return {
    ...createCategoryOperations(runtime),
    ...createSearchOperations(runtime),
    ...createReportOperations(runtime),
    ...posts,
    ...comments,
    ...likes,
    ...drafts,
    publishDraft: afterCommit(drafts.publishDraft, deps.onEvents),
    ...scheduled,
    ...createFollowOperations(runtime),
    ...memberEmail,
    emailPostToMembers: afterCommit(memberEmail.emailPostToMembers, deps.onEvents),
    publishScheduledPost: afterCommit(scheduled.publishScheduledPost, deps.onEvents),
    createPost: afterCommit(posts.createPost, deps.onEvents),
    createComment: afterCommit(comments.createComment, deps.onEvents),
    toggleLike: afterCommit(likes.toggleLike, deps.onEvents),
    deletePost: afterCommitVoid(posts.deletePost, deps.onEvents),
    deleteComment: afterCommitVoid(comments.deleteComment, deps.onEvents),
  };
}

export type PostsService = ReturnType<typeof createPostsService>;

export function createDefaultPostsService(
  options: Pick<PostsServiceOptions, "onEvents"> = {},
): PostsService {
  return createPostsService({
    repo: createPostgresPostsRepository(getDb()),
    storage: getStorage(),
    rateLimit: (rule, userId) => getRateLimiter().consume(rule, userId),
    uploadGuard: getCommunityUploadGuard(),
    ...options,
  });
}
