import { getPostsService } from "@cohory/api/services";
import { ForbiddenError } from "@cohory/authz";
import { CategoryNotFoundError, PostsError, type CategoryDetailView } from "@cohory/posts";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { loadCommunityPage, type FullCommunityPage } from "../communities/load";
import { withAuthorLevels } from "../members/author-levels";
import {
  canCreateComment,
  canCreatePost,
  canEmailMembers,
  canFollow,
  canLike,
  postPermissions,
  type CommunityAccess,
} from "./permissions";
import { toFeedComments, toFeedPost, type FeedComment, type FeedPost } from "./views";

export function communityAccess(page: FullCommunityPage): CommunityAccess {
  return {
    actor: page.actor,
    role: page.role,
    entitled: page.entitled,
    privacy: page.community.privacy,
  };
}

export type FeedData =
  | { readonly status: "forbidden" }
  | {
      readonly status: "ok";
      readonly posts: FeedPost[];
      readonly nextCursor: string | null;
      readonly canPost: boolean;
      readonly canLike: boolean;
      readonly scheduledCount: number;
      readonly categories: readonly CategoryDetailView[];
      readonly filter: FeedFilter;
      readonly lastVisitAt: string | null;
      readonly memberEmail: MemberEmailState | null;
    };

export interface MemberEmailState {
  readonly lastSentAt: string | null;
  readonly nextAvailableAt: string | null;
}

export interface FeedFilter {
  readonly category: string | null;
  readonly sort: "active" | "new" | "top";
}

export async function loadFeed(page: FullCommunityPage, filter: FeedFilter): Promise<FeedData> {
  const access = communityAccess(page);
  const service = getPostsService();
  const canPost = canCreatePost(access);
  try {
    const lastVisit = await service.getFeedVisit(page.actor, page.community.id);
    const [result, categories, scheduled, memberEmail] = await Promise.all([
      service.listFeed(page.actor, page.community.id, {
        category: filter.category,
        sort: filter.sort,
      }),
      service.listCategories(page.actor, page.community.id),
      canPost && page.actor.kind === "user"
        ? service.listScheduledPosts(page.actor, page.community.id)
        : Promise.resolve([]),
      canEmailMembers(access)
        ? service.getMemberEmailStatus(page.actor, page.community.id)
        : Promise.resolve(null),
    ]);
    return {
      status: "ok",
      categories,
      filter,
      posts: await withAuthorLevels(
        page.actor,
        page.community.id,
        result.data.map((post) => toFeedPost(access, post)),
      ),
      nextCursor: result.nextCursor,
      lastVisitAt: lastVisit?.toISOString() ?? null,
      memberEmail: memberEmail && {
        lastSentAt: memberEmail.lastSentAt?.toISOString() ?? null,
        nextAvailableAt: memberEmail.nextAvailableAt?.toISOString() ?? null,
      },
      canPost,
      canLike: canLike(access),
      scheduledCount: scheduled.length,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "forbidden" };
    if (error instanceof CategoryNotFoundError) notFound();
    throw error;
  }
}

export interface PostDetailData {
  readonly page: FullCommunityPage;
  readonly post: FeedPost;
  readonly comments: FeedComment[];
  readonly hasMoreComments: boolean;
  readonly canComment: boolean;
  readonly canLike: boolean;
  readonly canFollow: boolean;
}

export const loadPostDetail = cache(
  async (slug: string, postId: string): Promise<PostDetailData> => {
    const page = await loadCommunityPage(slug);
    if (page.access !== "full") notFound();
    const access = communityAccess(page);
    const service = getPostsService();
    try {
      const [post, comments] = await Promise.all([
        service.getPost(page.actor, page.community.id, postId),
        service.listComments(page.actor, page.community.id, postId, { limit: 100 }),
      ]);
      if (post.scheduledAt) {
        redirect(`/c/${page.community.slug}/posts/scheduled`);
      }
      const [[feedPost], feedComments] = await Promise.all([
        withAuthorLevels(page.actor, page.community.id, [toFeedPost(access, post)]),
        withAuthorLevels(page.actor, page.community.id, toFeedComments(access, comments.data)),
      ]);
      if (!feedPost) notFound();
      return {
        page,
        post: feedPost,
        comments: feedComments,
        hasMoreComments: comments.nextCursor !== null,
        canComment: canCreateComment(access),
        canLike: canLike(access),
        canFollow: canFollow(access),
      };
    } catch (error) {
      if (error instanceof PostsError || error instanceof ForbiddenError) {
        notFound();
      }
      throw error;
    }
  },
);

export interface ScheduledPostRow {
  readonly post: FeedPost;
  readonly categoryId: string | null;
  readonly scheduledAt: string;
  readonly own: boolean;
  readonly canCancel: boolean;
}

export interface ScheduledPostsData {
  readonly rows: ScheduledPostRow[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

export async function loadScheduledPosts(page: FullCommunityPage): Promise<ScheduledPostsData> {
  const access = communityAccess(page);
  const actor = page.actor;
  if (actor.kind !== "user" || !canCreatePost(access)) notFound();
  try {
    const service = getPostsService();
    const [posts, categories] = await Promise.all([
      service.listScheduledPosts(actor, page.community.id),
      service.listCategories(actor, page.community.id),
    ]);
    const rows = posts.flatMap((post) => {
      if (!post.scheduledAt) return [];
      const permissions = postPermissions(access, post.author.id);
      return [
        {
          post: toFeedPost(access, post),
          categoryId: post.category?.id ?? null,
          scheduledAt: post.scheduledAt.toISOString(),
          own: post.author.id === actor.userId,
          canCancel: permissions.delete,
        },
      ];
    });
    return {
      rows,
      categories: categories
        .filter((category) => category.canPost)
        .map((category) => ({ id: category.id, name: category.name })),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}
