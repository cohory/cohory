import type { ContentDocument } from "@cohory/content";
import type { CategoryColor } from "@cohory/db/schema";

import type {
  AgentSummary,
  AuthorSummary,
  CategoryRecord,
  CategorySummary,
  CommentRow,
  ConversationSummary,
  DraftRow,
  PostRow,
  StaffRole,
} from "./repository";

export interface PostImageView {
  readonly key: string;
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface DeletionView {
  readonly at: Date;
  readonly by: AuthorSummary | null;
}

export type CategoryView = CategorySummary;

export interface CategoryDetailView extends CategorySummary {
  readonly color: CategoryColor;
  readonly position: number;
  readonly staffOnly: boolean;
  readonly canPost: boolean;
}

export type PostStatus = "published" | "draft";

export interface PostView {
  readonly id: string;
  readonly communityId: string;
  readonly status: PostStatus;
  readonly author: AuthorSummary;
  readonly authorRole: StaffRole | null;
  readonly agent: AgentSummary | null;
  readonly category: CategoryView | null;
  readonly title: string | null;
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly excerpt: string;
  readonly images: readonly PostImageView[];
  readonly pinnedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly editedAt: Date | null;
  readonly likeCount: number;
  readonly commentCount: number;
  readonly viewerHasLiked: boolean;
  readonly viewerFollows: boolean;
  readonly conversation: ConversationSummary | null;
  readonly lastActivityAt: Date;
  readonly deletion: DeletionView | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommentView {
  readonly id: string;
  readonly postId: string;
  readonly parentId: string | null;
  readonly author: AuthorSummary;
  readonly authorRole: StaffRole | null;
  readonly agent: AgentSummary | null;
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly likeCount: number;
  readonly viewerHasLiked: boolean;
  readonly editedAt: Date | null;
  readonly deletion: DeletionView | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommentThreadView extends CommentView {
  readonly replies: readonly CommentView[];
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

export interface LikeState {
  readonly liked: boolean;
  readonly likeCount: number;
}

export interface FollowState {
  readonly following: boolean;
}

export interface MemberEmailStatus {
  readonly lastSentAt: Date | null;
  readonly nextAvailableAt: Date | null;
}

export function toPostView(
  row: PostRow,
  imageUrl: (key: string) => string,
  deletion: DeletionView | null = null,
): PostView {
  return {
    id: row.id,
    communityId: row.communityId,
    status: "published",
    author: row.author,
    authorRole: row.authorRole,
    agent: row.agent,
    category: row.category,
    title: row.title,
    body: row.body,
    bodyHtml: row.bodyHtml,
    excerpt: row.excerpt,
    images: [...row.images]
      .sort((a, b) => a.position - b.position)
      .map((image) => ({
        key: image.key,
        url: imageUrl(image.key),
        width: image.width,
        height: image.height,
      })),
    pinnedAt: row.pinnedAt,
    scheduledAt: row.scheduledAt,
    editedAt: row.editedAt,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewerHasLiked: row.viewerHasLiked,
    viewerFollows: row.viewerFollows,
    conversation: row.conversation,
    lastActivityAt: row.lastActivityAt,
    deletion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toCommentView(row: CommentRow, deletion: DeletionView | null = null): CommentView {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    author: row.author,
    authorRole: row.authorRole,
    agent: row.agent,
    body: row.body,
    bodyHtml: row.bodyHtml,
    likeCount: row.likeCount,
    viewerHasLiked: row.viewerHasLiked,
    editedAt: row.editedAt,
    deletion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toCategoryDetailView(
  record: CategoryRecord,
  canPostRestricted: boolean,
): CategoryDetailView {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    color: record.color,
    position: record.position,
    staffOnly: record.staffOnly,
    canPost: !record.staffOnly || canPostRestricted,
  };
}

export function toDraftView(row: DraftRow): PostView {
  return {
    id: row.id,
    communityId: row.communityId,
    status: "draft",
    scheduledAt: null,
    author: row.author,
    authorRole: null,
    agent: row.agent,
    category: row.category,
    title: row.title,
    body: row.body,
    bodyHtml: row.bodyHtml,
    excerpt: row.excerpt,
    images: [],
    pinnedAt: null,
    editedAt: null,
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    viewerFollows: false,
    conversation: null,
    lastActivityAt: row.updatedAt,
    deletion: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
