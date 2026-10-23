import type { CommunityPrivacy, CommunityRole } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";
import type { CategoryColor, ReactionSubjectType } from "@cohory/db/schema";

import type { ContentDocument } from "@cohory/content";
import type { PostEvent } from "./events";
import type { ReportsStore } from "./reports/store";

export interface CommunityRecord {
  readonly id: CommunityId;
  readonly privacy: CommunityPrivacy;
  readonly archivedAt: Date | null;
}

export interface MemberRecord {
  readonly role: CommunityRole;
  readonly status: "pending" | "active" | "removed" | "banned";
}

export interface AuthorSummary {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
}

export interface ImageRecord {
  readonly key: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly position: number;
}

export interface CategoryRecord {
  readonly id: string;
  readonly communityId: string;
  readonly name: string;
  readonly slug: string;
  readonly color: CategoryColor;
  readonly position: number;
  readonly staffOnly: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly color: CategoryColor;
}

export interface NewCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly color: CategoryColor;
  readonly position: number;
  readonly staffOnly: boolean;
}

export interface CategoryPatch {
  readonly name?: string;
  readonly slug?: string;
  readonly color?: CategoryColor;
  readonly staffOnly?: boolean;
}

export interface PostRecord {
  readonly id: string;
  readonly communityId: string;
  readonly authorId: string;
  readonly agentId: string | null;
  readonly categoryId: string | null;
  readonly title: string | null;
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly excerpt: string;
  readonly pinnedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly editedAt: Date | null;
  readonly lastActivityAt: Date;
  readonly commentCount: number;
  readonly likeCount: number;
  readonly deletedAt: Date | null;
  readonly deletedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommentRecord {
  readonly id: string;
  readonly communityId: string;
  readonly postId: string;
  readonly authorId: string;
  readonly agentId: string | null;
  readonly parentId: string | null;
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly likeCount: number;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly deletedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type StaffRole = Exclude<CommunityRole, "member">;

export interface PostRow extends PostRecord {
  readonly author: AuthorSummary;
  readonly authorRole: StaffRole | null;
  readonly agent: AgentSummary | null;
  readonly category: CategorySummary | null;
  readonly images: readonly ImageRecord[];
  readonly viewerHasLiked: boolean;
  readonly viewerFollows: boolean;
  readonly conversation: ConversationSummary | null;
}

export interface CommentRow extends CommentRecord {
  readonly author: AuthorSummary;
  readonly authorRole: StaffRole | null;
  readonly agent: AgentSummary | null;
  readonly viewerHasLiked: boolean;
}

export interface ConversationSummary {
  readonly recentCommenters: readonly AuthorSummary[];
  readonly lastCommentAt: Date;
}

export interface MemberEmailRecord {
  readonly sentAt: Date;
  readonly sentBy: string | null;
}

export interface RenderedContent {
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly bodyText: string;
}

export interface NewPost extends RenderedContent {
  readonly id: string;
  readonly authorId: string;
  readonly agentId: string | null;
  readonly categoryId: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  readonly scheduledAt: Date | null;
  readonly createdAt: Date;
}

export interface DraftRecord extends RenderedContent {
  readonly id: string;
  readonly communityId: string;
  readonly authorId: string;
  readonly agentId: string | null;
  readonly categoryId: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DraftRow extends DraftRecord {
  readonly author: AuthorSummary;
  readonly agent: AgentSummary | null;
  readonly category: CategorySummary | null;
}

export type NewDraft = Omit<DraftRecord, "communityId" | "updatedAt">;

export interface PostContentPatch extends RenderedContent {
  readonly title: string | null;
  readonly excerpt: string;
  readonly editedAt: Date;
}

export interface NewComment extends RenderedContent {
  readonly id: string;
  readonly postId: string;
  readonly authorId: string;
  readonly agentId: string | null;
  readonly parentId: string | null;
  readonly createdAt: Date;
}

export interface CommentContentPatch extends RenderedContent {
  readonly editedAt: Date;
}

export const feedSorts = ["active", "new", "top"] as const;

export type FeedSort = (typeof feedSorts)[number];

export interface FeedCursor {
  readonly sort: FeedSort;
  readonly pinnedAt: Date | null;
  readonly score: number | null;
  readonly at: Date;
  readonly id: string;
}

export interface FeedQuery {
  readonly sort: FeedSort;
  readonly topSince: Date;
  readonly categoryId: string | null;
  readonly after: FeedCursor | null;
  readonly limit: number;
}

export interface CommentCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface LikeRecord {
  readonly reactionId: string;
  readonly subjectAuthorId: string;
  readonly userId: string;
}

export interface MemberByUsername {
  readonly userId: string;
  readonly username: string;
}

export interface ReactionTarget {
  readonly subjectType: ReactionSubjectType;
  readonly subjectId: string;
}

export interface PostSearchRow {
  readonly postId: string;
  readonly commentId: string | null;
  readonly title: string | null;
  readonly headline: string;
  readonly rank: number;
  readonly authorName: string;
  readonly createdAt: Date;
}

export interface PostsStore {
  readonly reports: ReportsStore;
  appendEvents(outboxId: string, events: readonly PostEvent[]): Promise<void>;
  findAccess(userId: string, now: Date): Promise<CommunityAccess>;
  filterActiveMembers(userIds: readonly string[]): Promise<Set<string>>;
  findActiveMembersByUsername(usernames: readonly string[]): Promise<MemberByUsername[]>;

  insertPost(post: NewPost, images: readonly ImageRecord[]): Promise<void>;
  findPost(postId: string): Promise<PostRecord | null>;
  getPostRow(postId: string, viewerId: string | null): Promise<PostRow | null>;
  updatePostContent(
    postId: string,
    patch: PostContentPatch,
    images: readonly ImageRecord[] | null,
  ): Promise<void>;
  softDeletePost(postId: string, at: Date, by: string): Promise<void>;
  listScheduledPosts(authorId: string | null, limit: number): Promise<PostRow[]>;
  reschedulePost(postId: string, scheduledAt: Date): Promise<void>;
  deleteScheduledPost(postId: string): Promise<boolean>;
  publishScheduledPost(postId: string, at: Date): Promise<boolean>;
  discardScheduledPost(postId: string, at: Date): Promise<boolean>;
  findUserSummary(userId: string): Promise<AuthorSummary | null>;
  listLikesOnPost(postId: string): Promise<LikeRecord[]>;
  listLikesOnComments(commentIds: readonly string[]): Promise<LikeRecord[]>;
  lockPins(): Promise<void>;
  countPinned(): Promise<number>;
  setPinnedAt(postId: string, pinnedAt: Date | null): Promise<void>;
  listFeed(viewerId: string | null, query: FeedQuery): Promise<PostRow[]>;
  findFeedVisit(userId: string): Promise<Date | null>;
  recordFeedVisit(userId: string, at: Date): Promise<void>;

  followPost(postId: string, userId: string, at: Date): Promise<void>;
  unfollowPost(postId: string, userId: string): Promise<void>;

  findMemberEmail(): Promise<MemberEmailRecord | null>;
  claimMemberEmail(at: Date, by: string, since: Date): Promise<boolean>;
  updatePostCategory(postId: string, categoryId: string | null): Promise<void>;

  searchPosts(tsQuery: string, limit: number): Promise<PostSearchRow[]>;
  searchComments(tsQuery: string, limit: number): Promise<PostSearchRow[]>;

  listCategories(): Promise<CategoryRecord[]>;
  findCategory(categoryId: string): Promise<CategoryRecord | null>;
  findCategoryBySlug(slug: string): Promise<CategoryRecord | null>;
  lockCategories(): Promise<void>;
  insertCategory(category: NewCategory): Promise<CategoryRecord>;
  updateCategory(categoryId: string, patch: CategoryPatch): Promise<CategoryRecord | null>;
  deleteCategory(categoryId: string, moveTo: string | null): Promise<boolean>;
  setCategoryPositions(orderedIds: readonly string[]): Promise<void>;

  insertDraft(draft: NewDraft): Promise<void>;
  findDraft(draftId: string): Promise<DraftRecord | null>;
  listDrafts(authorId: string | null): Promise<DraftRow[]>;
  deleteDraft(draftId: string): Promise<void>;

  insertComment(comment: NewComment): Promise<void>;
  findComment(commentId: string): Promise<CommentRecord | null>;
  getCommentRow(commentId: string, viewerId: string | null): Promise<CommentRow | null>;
  updateCommentContent(commentId: string, patch: CommentContentPatch): Promise<void>;
  softDeleteCommentThread(commentId: string, at: Date, by: string): Promise<string[]>;
  adjustCommentCount(postId: string, delta: number): Promise<void>;
  touchPostActivity(postId: string, at: Date): Promise<void>;
  listTopLevelComments(
    postId: string,
    viewerId: string | null,
    after: CommentCursor | null,
    limit: number,
    includeDeleted?: boolean,
  ): Promise<CommentRow[]>;
  listReplies(
    postId: string,
    parentIds: readonly string[],
    viewerId: string | null,
    includeDeleted?: boolean,
  ): Promise<CommentRow[]>;

  addReaction(
    target: ReactionTarget,
    userId: string,
    subjectAuthorId: string,
  ): Promise<string | null>;
  removeReaction(target: ReactionTarget, userId: string): Promise<string | null>;
  adjustLikeCount(target: ReactionTarget, delta: number): Promise<number>;
  readLikeCount(target: ReactionTarget): Promise<number>;
}

export interface DueScheduledPost {
  readonly id: string;
  readonly communityId: CommunityId;
  readonly authorId: string;
}

export interface PostsRepository {
  findCommunity(communityId: CommunityId): Promise<CommunityRecord | null>;
  listDueScheduledPosts(now: Date, limit: number): Promise<DueScheduledPost[]>;
  inCommunity<T>(communityId: CommunityId, fn: (store: PostsStore) => Promise<T>): Promise<T>;
}
