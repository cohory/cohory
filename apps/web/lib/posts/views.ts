import type {
  CommentThreadView,
  CommentView,
  DeletionView,
  PostView,
  StaffRole,
} from "@cohory/posts";
import type { CategoryColor } from "@cohory/db/schema";
import type { PostDocument } from "@cohory/ui";

import type { AuthorLevel } from "../members/views";
import { toPostDocument } from "./document";
import {
  commentPermissions,
  postActionIds,
  postPermissions,
  type CommentPermissions,
  type CommunityAccess,
  type PostActionId,
} from "./permissions";

export interface FeedAuthor {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly agentName?: string | null;
  readonly level?: AuthorLevel | null;
}

export interface FeedDeletion {
  readonly byName: string | null;
  readonly at: string;
}

export interface FeedCategory {
  readonly name: string;
  readonly slug: string;
  readonly color: CategoryColor;
}

export interface FeedPerson {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface FeedConversation {
  readonly recentCommenters: readonly FeedPerson[];
  readonly lastCommentAt: string;
}

export interface FeedPost {
  readonly id: string;
  readonly title: string | null;
  readonly category: FeedCategory | null;
  readonly content: PostDocument;
  readonly author: FeedAuthor;
  readonly authorRole: StaffRole | null;
  readonly createdAt: string;
  readonly edited: boolean;
  readonly pinned: boolean;
  readonly likeCount: number;
  readonly likedByViewer: boolean;
  readonly commentCount: number;
  readonly conversation: FeedConversation | null;
  readonly lastActivityAt: string;
  readonly byViewer: boolean;
  readonly viewerFollows: boolean;
  readonly actions: readonly PostActionId[];
  readonly deletion: FeedDeletion | null;
}

export interface FeedComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly author: FeedAuthor;
  readonly authorRole: StaffRole | null;
  readonly content: PostDocument;
  readonly createdAt: string;
  readonly likeCount: number;
  readonly likedByViewer: boolean;
  readonly permissions: CommentPermissions;
  readonly deletion: FeedDeletion | null;
}

function author(view: PostView["author"], agent: PostView["agent"]): FeedAuthor {
  return { id: view.id, name: view.name, avatarUrl: view.image, agentName: agent?.name ?? null };
}

function feedDeletion(deletion: DeletionView | null): FeedDeletion | null {
  return deletion ? { byName: deletion.by?.name ?? null, at: deletion.at.toISOString() } : null;
}

const noCommentPermissions: CommentPermissions = { edit: false, delete: false, report: false };

function feedConversation(post: PostView): FeedConversation | null {
  if (!post.conversation) return null;
  return {
    recentCommenters: post.conversation.recentCommenters.map((person) => ({
      id: person.id,
      name: person.name,
      avatarUrl: person.image,
    })),
    lastCommentAt: post.conversation.lastCommentAt.toISOString(),
  };
}

export function isNewSince(post: FeedPost, since: string | null): boolean {
  if (!since || post.deletion || post.byViewer) return false;
  return Date.parse(post.lastActivityAt) > Date.parse(since);
}

export function toFeedPost(access: CommunityAccess, post: PostView): FeedPost {
  const pinned = post.pinnedAt !== null;
  return {
    id: post.id,
    title: post.title,
    category: post.category
      ? { name: post.category.name, slug: post.category.slug, color: post.category.color }
      : null,
    content: toPostDocument(post.body, post.images),
    author: author(post.author, post.agent),
    authorRole: post.authorRole,
    createdAt: post.createdAt.toISOString(),
    edited: post.editedAt !== null,
    pinned,
    likeCount: post.likeCount,
    likedByViewer: post.viewerHasLiked,
    commentCount: post.commentCount,
    conversation: feedConversation(post),
    lastActivityAt: post.lastActivityAt.toISOString(),
    byViewer: access.actor.kind === "user" && access.actor.userId === post.author.id,
    viewerFollows: post.viewerFollows,
    actions: post.deletion ? [] : postActionIds(postPermissions(access, post.author.id), pinned),
    deletion: feedDeletion(post.deletion),
  };
}

function toFeedComment(access: CommunityAccess, comment: CommentView): FeedComment {
  return {
    id: comment.id,
    parentId: comment.parentId,
    author: author(comment.author, comment.agent),
    authorRole: comment.authorRole,
    content: toPostDocument(comment.body),
    createdAt: comment.createdAt.toISOString(),
    likeCount: comment.likeCount,
    likedByViewer: comment.viewerHasLiked,
    permissions: comment.deletion
      ? noCommentPermissions
      : commentPermissions(access, comment.author.id),
    deletion: feedDeletion(comment.deletion),
  };
}

export function toFeedComments(
  access: CommunityAccess,
  threads: readonly CommentThreadView[],
): FeedComment[] {
  return threads.flatMap((thread) => [
    toFeedComment(access, thread),
    ...thread.replies.map((reply) => toFeedComment(access, reply)),
  ]);
}
