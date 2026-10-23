"use server";

import { getPostsService } from "@cohory/api/services";
import { getCommunitiesService } from "@cohory/communities";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { withAuthorLevels } from "../members/author-levels";
import { resolveCommunity, type CommunityContext } from "./context";
import { toContentDocument } from "./document";
import { actionFailure, type ActionResult } from "./errors";
import { emailMembersSafely } from "./member-email";
import {
  mentionSearchLimit,
  normalizeMentionName,
  searchMentionCandidates,
  type MentionCandidate,
} from "./mentions";
import {
  commentRefSchema,
  createCommentSchema,
  createPostSchema,
  feedPageSchema,
  feedVisitSchema,
  followPostSchema,
  mentionSearchSchema,
  pinPostSchema,
  postRefSchema,
  toggleLikeSchema,
  updateCommentSchema,
  updatePostSchema,
  updateScheduledPostSchema,
  type CommentRefInput,
  type CreateCommentInput,
  type CreatePostInput,
  type FeedPageInput,
  type FeedVisitInput,
  type FollowPostInput,
  type MentionSearchInput,
  type PinPostInput,
  type PostRefInput,
  type ToggleLikeInput,
  type UpdateCommentInput,
  type UpdatePostInput,
  type UpdateScheduledPostInput,
} from "./schemas";
import { toFeedPost, type FeedPost } from "./views";

async function run<I extends { slug: string }, T>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, context: CommunityContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const input = schema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return { ok: true, data: await fn(input, context) };
  } catch (error) {
    const failure = actionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

function revalidateFeed(context: CommunityContext, postId?: string): void {
  revalidatePath(`/c/${context.slug}`);
  if (postId) revalidatePath(`/c/${context.slug}/posts/${postId}`);
}

export interface CreatedPost {
  readonly id: string;
  readonly scheduled: boolean;
  readonly emailFailure: string | null;
}

function emailMembers(context: CommunityContext, postId: string): Promise<string | null> {
  return emailMembersSafely(
    () => getPostsService().emailPostToMembers(context.access.actor, context.communityId, postId),
    { communityId: context.communityId, postId },
  );
}

export async function createPostAction(raw: CreatePostInput): Promise<ActionResult<CreatedPost>> {
  return run(createPostSchema, raw, async (input, context) => {
    const { post } = await getPostsService().createPost(context.access.actor, context.communityId, {
      title: input.title,
      body: toContentDocument(input.document),
      categoryId: input.categoryId,
      scheduledAt: input.scheduledAt,
    });
    const scheduled = post.scheduledAt !== null;
    const emailFailure =
      input.emailMembers && !scheduled ? await emailMembers(context, post.id) : null;
    revalidateFeed(context);
    revalidatePath(`/c/${context.slug}/posts/scheduled`);
    return { id: post.id, scheduled, emailFailure };
  });
}

export async function followPostAction(
  raw: FollowPostInput,
): Promise<ActionResult<{ following: boolean }>> {
  return run(followPostSchema, raw, async (input, context) => {
    const service = getPostsService();
    const state = input.following
      ? await service.followPost(context.access.actor, context.communityId, input.postId)
      : await service.unfollowPost(context.access.actor, context.communityId, input.postId);
    revalidatePath(`/c/${context.slug}/posts/${input.postId}`);
    return { following: state.following };
  });
}

function revalidateScheduled(context: CommunityContext): void {
  revalidatePath(`/c/${context.slug}/posts/scheduled`);
  revalidatePath(`/c/${context.slug}`);
}

export async function updateScheduledPostAction(
  raw: UpdateScheduledPostInput,
): Promise<ActionResult<{ id: string }>> {
  return run(updateScheduledPostSchema, raw, async (input, context) => {
    const post = await getPostsService().updateScheduledPost(
      context.access.actor,
      context.communityId,
      input.postId,
      {
        title: input.title,
        body: toContentDocument(input.document),
        categoryId: input.categoryId,
        scheduledAt: input.scheduledAt,
      },
    );
    revalidateScheduled(context);
    return { id: post.id };
  });
}

export async function cancelScheduledPostAction(raw: PostRefInput): Promise<ActionResult<null>> {
  return run(postRefSchema, raw, async (input, context) => {
    await getPostsService().cancelScheduledPost(
      context.access.actor,
      context.communityId,
      input.postId,
    );
    revalidateScheduled(context);
    return null;
  });
}

export async function publishScheduledPostAction(
  raw: PostRefInput,
): Promise<ActionResult<{ id: string }>> {
  return run(postRefSchema, raw, async (input, context) => {
    const { post } = await getPostsService().publishScheduledPost(
      context.access.actor,
      context.communityId,
      input.postId,
    );
    revalidateScheduled(context);
    return { id: post.id };
  });
}

export async function updatePostAction(
  raw: UpdatePostInput,
): Promise<ActionResult<{ id: string }>> {
  return run(updatePostSchema, raw, async (input, context) => {
    const post = await getPostsService().updatePost(
      context.access.actor,
      context.communityId,
      input.postId,
      { title: input.title, body: toContentDocument(input.document) },
    );
    revalidateFeed(context, post.id);
    return { id: post.id };
  });
}

export async function deletePostAction(raw: PostRefInput): Promise<ActionResult<null>> {
  return run(postRefSchema, raw, async (input, context) => {
    await getPostsService().deletePost(context.access.actor, context.communityId, input.postId);
    revalidateFeed(context, input.postId);
    return null;
  });
}

export async function pinPostAction(raw: PinPostInput): Promise<ActionResult<{ pinned: boolean }>> {
  return run(pinPostSchema, raw, async (input, context) => {
    const service = getPostsService();
    const post = input.pinned
      ? await service.pinPost(context.access.actor, context.communityId, input.postId)
      : await service.unpinPost(context.access.actor, context.communityId, input.postId);
    revalidateFeed(context, post.id);
    return { pinned: post.pinnedAt !== null };
  });
}

export async function toggleLikeAction(
  raw: ToggleLikeInput,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  return run(toggleLikeSchema, raw, async (input, context) => {
    const { liked, likeCount } = await getPostsService().toggleLike(
      context.access.actor,
      context.communityId,
      { subjectType: input.subjectType, subjectId: input.subjectId, liked: input.liked },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return { liked, likeCount };
  });
}

export async function createCommentAction(
  raw: CreateCommentInput,
): Promise<ActionResult<{ id: string }>> {
  return run(createCommentSchema, raw, async (input, context) => {
    const { comment } = await getPostsService().createComment(
      context.access.actor,
      context.communityId,
      input.postId,
      { body: toContentDocument(input.document), parentId: input.parentId },
    );
    revalidateFeed(context, input.postId);
    return { id: comment.id };
  });
}

export async function updateCommentAction(
  raw: UpdateCommentInput,
): Promise<ActionResult<{ id: string }>> {
  return run(updateCommentSchema, raw, async (input, context) => {
    const comment = await getPostsService().updateComment(
      context.access.actor,
      context.communityId,
      input.commentId,
      { body: toContentDocument(input.document) },
    );
    revalidateFeed(context, comment.postId);
    return { id: comment.id };
  });
}

export async function deleteCommentAction(raw: CommentRefInput): Promise<ActionResult<null>> {
  return run(commentRefSchema, raw, async (input, context) => {
    await getPostsService().deleteComment(
      context.access.actor,
      context.communityId,
      input.commentId,
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function loadFeedPageAction(
  raw: FeedPageInput,
): Promise<ActionResult<{ posts: FeedPost[]; nextCursor: string | null }>> {
  return run(feedPageSchema, raw, async (input, context) => {
    const page = await getPostsService().listFeed(context.access.actor, context.communityId, {
      cursor: input.cursor,
      category: input.category,
      sort: input.sort,
    });
    return {
      posts: await withAuthorLevels(
        context.access.actor,
        context.communityId,
        page.data.map((post) => toFeedPost(context.access, post)),
      ),
      nextCursor: page.nextCursor,
    };
  });
}

export async function recordFeedVisitAction(raw: FeedVisitInput): Promise<ActionResult<null>> {
  return run(feedVisitSchema, raw, async (_input, context) => {
    await getPostsService().recordFeedVisit(context.access.actor, context.communityId);
    return null;
  });
}

export async function searchMentionsAction(
  raw: MentionSearchInput,
): Promise<ActionResult<MentionCandidate[]>> {
  return run(mentionSearchSchema, raw, async (input, context) => {
    const prefix = normalizeMentionName(input.query);
    if (prefix === "") return [];
    const members = await getCommunitiesService().searchMembersByName(
      context.access.actor,
      context.communityId,
      { prefix, limit: mentionSearchLimit },
    );
    return searchMentionCandidates(members, input.query);
  });
}
