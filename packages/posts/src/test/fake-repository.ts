import type { CommunityRole } from "@cohory/authz";
import { newId, parseCommunityId, type CommunityId } from "@cohory/db";
import { communityAccessFrom } from "@cohory/entitlements/access";

import { feedCursorOf } from "../cursor";
import type { PostEvent } from "../events";
import { createFakeReportsStore, type FakeReport } from "./fake-reports";
import type {
  AuthorSummary,
  CategoryRecord,
  CommentRecord,
  CommentRow,
  CommunityRecord,
  DraftRecord,
  FeedCursor,
  FeedSort,
  ImageRecord,
  MemberEmailRecord,
  MemberRecord,
  PostRecord,
  PostRow,
  PostsRepository,
  PostsStore,
  ReactionTarget,
  StaffRole,
} from "../repository";
import { recentCommentersLimit } from "../schemas";

interface Reaction extends ReactionTarget {
  readonly id: string;
  readonly communityId: string;
  readonly userId: string;
  readonly subjectAuthorId: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface FakePostsRepository extends PostsRepository {
  addCommunity(id: string, privacy?: "public" | "private"): CommunityRecord;
  archiveCommunity(id: string, at?: Date): void;
  addMember(
    communityId: string,
    userId: string,
    role?: CommunityRole,
    status?: MemberRecord["status"],
  ): void;
  addUser(userId: string, name: string): void;
  setUsername(userId: string, username: string): void;
  readonly posts: Map<string, Mutable<PostRecord>>;
  readonly comments: Map<string, Mutable<CommentRecord>>;
  readonly reactions: Reaction[];
  readonly images: Map<string, readonly ImageRecord[]>;
  readonly categories: Map<string, Mutable<CategoryRecord>>;
  readonly outbox: { id: string; communityId: string; events: readonly PostEvent[] }[];
  readonly reports: FakeReport[];
  readonly drafts: Map<string, DraftRecord>;
  readonly follows: Set<string>;
  readonly feedVisits: Map<string, Date>;
  readonly memberEmails: Map<string, MemberEmailRecord>;
}

function likeRecord(reaction: Reaction) {
  return {
    reactionId: reaction.id,
    subjectAuthorId: reaction.subjectAuthorId,
    userId: reaction.userId,
  };
}

type FeedKey = [number, number, number, string];

function feedKey(post: PostRecord, sort: FeedSort): FeedKey {
  const cursor = feedCursorOf(sort, post);
  return keyOf(cursor);
}

function keyOf(cursor: FeedCursor): FeedKey {
  return [
    cursor.pinnedAt ? cursor.pinnedAt.getTime() : -Infinity,
    cursor.score ?? 0,
    cursor.at.getTime(),
    cursor.id,
  ];
}

function compareDesc(a: FeedKey, b: FeedKey): number {
  if (a[0] !== b[0]) return b[0] - a[0];
  if (a[1] !== b[1]) return b[1] - a[1];
  if (a[2] !== b[2]) return b[2] - a[2];
  return a[3] < b[3] ? 1 : a[3] > b[3] ? -1 : 0;
}

function compareAsc(a: CommentRecord, b: CommentRecord): number {
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  return time !== 0 ? time : a.id.localeCompare(b.id);
}

export function createFakePostsRepository(): FakePostsRepository {
  const communities = new Map<CommunityId, CommunityRecord>();
  const members = new Map<string, MemberRecord>();
  const users = new Map<string, string>();
  const usernames = new Map<string, string>();
  const posts = new Map<string, Mutable<PostRecord>>();
  const comments = new Map<string, Mutable<CommentRecord>>();
  const images = new Map<string, readonly ImageRecord[]>();
  const categories = new Map<string, Mutable<CategoryRecord>>();
  const reactions: Reaction[] = [];
  const outbox: FakePostsRepository["outbox"] = [];
  const reports: FakeReport[] = [];
  const drafts = new Map<string, DraftRecord>();
  const follows = new Set<string>();
  const feedVisits = new Map<string, Date>();
  const memberEmails = new Map<string, MemberEmailRecord>();

  function author(id: string): AuthorSummary {
    return { id, name: users.get(id) ?? "Person", image: null };
  }

  function liked(subjectId: string, viewerId: string | null): boolean {
    return reactions.some((r) => r.subjectId === subjectId && r.userId === viewerId);
  }

  function store(communityId: CommunityId): PostsStore {
    const ownPost = (id: string) => {
      const post = posts.get(id);
      return post && post.communityId === communityId ? post : null;
    };
    const ownComment = (id: string) => {
      const comment = comments.get(id);
      return comment && comment.communityId === communityId ? comment : null;
    };
    const ownCategory = (id: string) => {
      const category = categories.get(id);
      return category && category.communityId === communityId ? category : null;
    };
    const categorySummary = (id: string | null) => {
      const category = id ? ownCategory(id) : null;
      return category
        ? { id: category.id, name: category.name, slug: category.slug, color: category.color }
        : null;
    };
    const staffRole = (userId: string): StaffRole | null => {
      const member = members.get(`${communityId}:${userId}`);
      return member?.status === "active" && member.role !== "member" ? member.role : null;
    };
    const conversation = (postId: string) => {
      const latest = new Map<string, Date>();
      for (const c of comments.values()) {
        if (c.communityId !== communityId || c.postId !== postId || c.deletedAt) continue;
        const seen = latest.get(c.authorId);
        if (!seen || c.createdAt > seen) latest.set(c.authorId, c.createdAt);
      }
      const ordered = [...latest.entries()].sort((a, b) => b[1].getTime() - a[1].getTime());
      const [first] = ordered;
      return first
        ? {
            recentCommenters: ordered.slice(0, recentCommentersLimit).map(([id]) => author(id)),
            lastCommentAt: first[1],
          }
        : null;
    };
    const postRow = (post: PostRecord, viewerId: string | null): PostRow => ({
      ...post,
      author: author(post.authorId),
      authorRole: staffRole(post.authorId),
      agent: post.agentId ? { id: post.agentId, name: "Agent" } : null,
      category: categorySummary(post.categoryId),
      images: images.get(post.id) ?? [],
      viewerHasLiked: liked(post.id, viewerId),
      viewerFollows: viewerId !== null && follows.has(`${post.id}:${viewerId}`),
      conversation: conversation(post.id),
    });
    const commentRow = (comment: CommentRecord, viewerId: string | null): CommentRow => ({
      ...comment,
      author: author(comment.authorId),
      authorRole: staffRole(comment.authorId),
      agent: comment.agentId ? { id: comment.agentId, name: "Agent" } : null,
      viewerHasLiked: liked(comment.id, viewerId),
    });
    const subject = (target: ReactionTarget) =>
      target.subjectType === "post" ? ownPost(target.subjectId) : ownComment(target.subjectId);

    return {
      reports: createFakeReportsStore(communityId, reports),
      async appendEvents(outboxId, events) {
        outbox.push({ id: outboxId, communityId, events });
      },
      async findAccess(userId, now) {
        return communityAccessFrom({
          membership: members.get(`${communityId}:${userId}`) ?? null,
          subscription: null,
          comp: null,
          paidPlanActive: false,
          now,
        });
      },
      async filterActiveMembers(userIds) {
        return new Set(
          userIds.filter((id) => members.get(`${communityId}:${id}`)?.status === "active"),
        );
      },
      async findActiveMembersByUsername(names) {
        const wanted = new Set(names.map((name) => name.toLowerCase()));
        return [...usernames.entries()]
          .filter(([userId, username]) => {
            const active = members.get(`${communityId}:${userId}`)?.status === "active";
            return active && wanted.has(username.toLowerCase());
          })
          .map(([userId, username]) => ({ userId, username }));
      },
      async insertDraft(draft) {
        drafts.set(draft.id, { ...draft, communityId, updatedAt: draft.createdAt });
      },
      async findDraft(draftId) {
        const draft = drafts.get(draftId);
        return draft && draft.communityId === communityId ? draft : null;
      },
      async listDrafts(authorId) {
        return [...drafts.values()]
          .filter((d) => d.communityId === communityId && (!authorId || d.authorId === authorId))
          .map((d) => ({
            ...d,
            author: author(d.authorId),
            agent: d.agentId ? { id: d.agentId, name: "Agent" } : null,
            category: categorySummary(d.categoryId),
          }));
      },
      async deleteDraft(draftId) {
        drafts.delete(draftId);
      },
      async listScheduledPosts(authorId, limit) {
        return [...posts.values()]
          .filter((p) => p.communityId === communityId && p.scheduledAt && !p.deletedAt)
          .filter((p) => !authorId || p.authorId === authorId)
          .sort(
            (a, b) =>
              (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, limit)
          .map((p) => postRow(p, null));
      },
      async reschedulePost(postId, scheduledAt) {
        const post = ownPost(postId);
        if (post?.scheduledAt) post.scheduledAt = scheduledAt;
      },
      async deleteScheduledPost(postId) {
        const post = ownPost(postId);
        if (!post?.scheduledAt || post.deletedAt) return false;
        posts.delete(postId);
        images.delete(postId);
        return true;
      },
      async publishScheduledPost(postId, at) {
        const post = ownPost(postId);
        if (!post?.scheduledAt || post.deletedAt) return false;
        Object.assign(post, {
          scheduledAt: null,
          createdAt: at,
          lastActivityAt: at,
          updatedAt: at,
        });
        return true;
      },
      async discardScheduledPost(postId, at) {
        const post = ownPost(postId);
        if (!post?.scheduledAt || post.deletedAt) return false;
        post.deletedAt = at;
        return true;
      },
      async insertPost(post, postImages) {
        posts.set(post.id, {
          ...post,
          communityId,
          pinnedAt: null,
          editedAt: null,
          lastActivityAt: post.createdAt,
          commentCount: 0,
          likeCount: 0,
          deletedAt: null,
          deletedBy: null,
          updatedAt: post.createdAt,
        });
        images.set(post.id, postImages);
      },
      async findPost(postId) {
        return ownPost(postId);
      },
      async getPostRow(postId, viewerId) {
        const post = ownPost(postId);
        return post ? postRow(post, viewerId) : null;
      },
      async updatePostContent(postId, patch, postImages) {
        const post = ownPost(postId);
        if (post) {
          Object.assign(post, patch, { updatedAt: patch.editedAt });
          if (postImages) images.set(postId, postImages);
        }
      },
      async softDeletePost(postId, at, by) {
        const post = ownPost(postId);
        if (post) {
          post.deletedAt = at;
          post.deletedBy = by;
        }
      },
      async findUserSummary(userId) {
        const name = users.get(userId);
        return name === undefined ? null : { id: userId, name, image: null };
      },
      async lockPins() {},
      async countPinned() {
        return [...posts.values()].filter(
          (p) => p.communityId === communityId && p.pinnedAt && !p.deletedAt && !p.scheduledAt,
        ).length;
      },
      async setPinnedAt(postId, pinnedAt) {
        const post = ownPost(postId);
        if (post) post.pinnedAt = pinnedAt;
      },
      async listFeed(viewerId, { sort, topSince, categoryId, after, limit }) {
        const cursor = after ? keyOf(after) : null;
        return [...posts.values()]
          .filter((p) => p.communityId === communityId && !p.deletedAt && !p.scheduledAt)
          .filter((p) => !categoryId || p.categoryId === categoryId)
          .filter((p) => sort !== "top" || p.pinnedAt !== null || p.createdAt >= topSince)
          .filter((p) => !cursor || compareDesc(cursor, feedKey(p, sort)) < 0)
          .sort((a, b) => compareDesc(feedKey(a, sort), feedKey(b, sort)))
          .slice(0, limit)
          .map((p) => postRow(p, viewerId));
      },
      async findFeedVisit(userId) {
        const key = `${communityId}:${userId}`;
        return members.get(key)?.status === "active" ? (feedVisits.get(key) ?? null) : null;
      },
      async recordFeedVisit(userId, at) {
        const key = `${communityId}:${userId}`;
        if (members.get(key)?.status === "active") feedVisits.set(key, at);
      },
      async followPost(postId, userId) {
        if (ownPost(postId)) follows.add(`${postId}:${userId}`);
      },
      async unfollowPost(postId, userId) {
        follows.delete(`${postId}:${userId}`);
      },
      async findMemberEmail() {
        return memberEmails.get(communityId) ?? null;
      },
      async claimMemberEmail(at, by, since) {
        const current = memberEmails.get(communityId);
        if (current && current.sentAt > since) return false;
        memberEmails.set(communityId, { sentAt: at, sentBy: by });
        return true;
      },
      async updatePostCategory(postId, categoryId) {
        const post = ownPost(postId);
        if (post) post.categoryId = categoryId;
      },
      async searchPosts(query, limit) {
        const terms = query.split(" & ").map((term) => term.replace(":*", ""));
        const matches = (text: string) =>
          terms.every((term) =>
            text
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .some((word) => word.startsWith(term)),
          );
        return [...posts.values()]
          .filter((p) => p.communityId === communityId && !p.deletedAt && !p.scheduledAt)
          .filter((p) => matches(`${p.title ?? ""} ${p.bodyText}`))
          .slice(0, limit)
          .map((p) => ({
            postId: p.id,
            commentId: null,
            title: p.title,
            headline: p.bodyText,
            rank: 1,
            authorName: author(p.authorId).name,
            createdAt: p.createdAt,
          }));
      },
      async searchComments(query, limit) {
        const terms = query.split(" & ").map((term) => term.replace(":*", ""));
        return [...comments.values()]
          .filter((c) => c.communityId === communityId && !c.deletedAt)
          .filter((c) => !ownPost(c.postId)?.deletedAt)
          .filter((c) => terms.every((term) => c.bodyText.toLowerCase().includes(term)))
          .slice(0, limit)
          .map((c) => ({
            postId: c.postId,
            commentId: c.id,
            title: ownPost(c.postId)?.title ?? null,
            headline: c.bodyText,
            rank: 0.5,
            authorName: author(c.authorId).name,
            createdAt: c.createdAt,
          }));
      },
      async listCategories() {
        return [...categories.values()]
          .filter((c) => c.communityId === communityId)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      },
      async findCategory(categoryId) {
        return ownCategory(categoryId);
      },
      async findCategoryBySlug(slug) {
        return (
          [...categories.values()].find(
            (c) => c.communityId === communityId && c.slug.toLowerCase() === slug.toLowerCase(),
          ) ?? null
        );
      },
      async lockCategories() {},
      async insertCategory(category) {
        const now = new Date();
        const record = { ...category, communityId, createdAt: now, updatedAt: now };
        categories.set(category.id, record);
        return record;
      },
      async updateCategory(categoryId, patch) {
        const category = ownCategory(categoryId);
        if (!category) return null;
        Object.assign(category, patch, { updatedAt: new Date() });
        return category;
      },
      async deleteCategory(categoryId, moveTo) {
        if (!ownCategory(categoryId)) return false;
        categories.delete(categoryId);
        const target = moveTo && ownCategory(moveTo) ? moveTo : null;
        for (const post of posts.values()) {
          if (post.categoryId === categoryId) post.categoryId = target;
        }
        return true;
      },
      async setCategoryPositions(orderedIds) {
        orderedIds.forEach((id, position) => {
          const category = ownCategory(id);
          if (category) category.position = position;
        });
      },
      async insertComment(comment) {
        comments.set(comment.id, {
          ...comment,
          communityId,
          likeCount: 0,
          editedAt: null,
          deletedAt: null,
          deletedBy: null,
          updatedAt: comment.createdAt,
        });
      },
      async findComment(commentId) {
        return ownComment(commentId);
      },
      async getCommentRow(commentId, viewerId) {
        const comment = ownComment(commentId);
        return comment ? commentRow(comment, viewerId) : null;
      },
      async updateCommentContent(commentId, patch) {
        const comment = ownComment(commentId);
        if (comment) Object.assign(comment, patch, { updatedAt: patch.editedAt });
      },
      async softDeleteCommentThread(commentId, at, by) {
        const hidden: string[] = [];
        for (const comment of comments.values()) {
          const inThread = comment.id === commentId || comment.parentId === commentId;
          if (comment.communityId === communityId && inThread && !comment.deletedAt) {
            comment.deletedAt = at;
            comment.deletedBy = by;
            hidden.push(comment.id);
          }
        }
        return hidden;
      },
      async listLikesOnPost(postId) {
        const liveComments = new Set(
          [...comments.values()]
            .filter((c) => c.communityId === communityId && c.postId === postId && !c.deletedAt)
            .map((c) => c.id),
        );
        return reactions
          .filter(
            (r) =>
              r.communityId === communityId &&
              ((r.subjectType === "post" && r.subjectId === postId) ||
                (r.subjectType === "comment" && liveComments.has(r.subjectId))),
          )
          .map(likeRecord);
      },
      async listLikesOnComments(commentIds) {
        return reactions
          .filter(
            (r) =>
              r.communityId === communityId &&
              r.subjectType === "comment" &&
              commentIds.includes(r.subjectId),
          )
          .map(likeRecord);
      },
      async touchPostActivity(postId, at) {
        const post = ownPost(postId);
        if (post && at > post.lastActivityAt) post.lastActivityAt = at;
      },
      async adjustCommentCount(postId, delta) {
        const post = ownPost(postId);
        if (post) post.commentCount += delta;
      },
      async listTopLevelComments(postId, viewerId, after, limit, includeDeleted = false) {
        return [...comments.values()]
          .filter(
            (c) =>
              c.communityId === communityId &&
              c.postId === postId &&
              !c.parentId &&
              (includeDeleted || !c.deletedAt),
          )
          .sort(compareAsc)
          .filter(
            (c) => !after || compareAsc(c, { ...c, createdAt: after.createdAt, id: after.id }) > 0,
          )
          .slice(0, limit)
          .map((c) => commentRow(c, viewerId));
      },
      async listReplies(postId, parentIds, viewerId, includeDeleted = false) {
        return [...comments.values()]
          .filter(
            (c) =>
              c.communityId === communityId &&
              c.postId === postId &&
              c.parentId !== null &&
              parentIds.includes(c.parentId) &&
              (includeDeleted || !c.deletedAt),
          )
          .sort(compareAsc)
          .map((c) => commentRow(c, viewerId));
      },
      async addReaction(target, userId, subjectAuthorId) {
        const exists = reactions.some(
          (r) =>
            r.subjectType === target.subjectType &&
            r.subjectId === target.subjectId &&
            r.userId === userId,
        );
        if (exists) return null;
        const id = newId();
        reactions.push({ ...target, id, communityId, userId, subjectAuthorId });
        return id;
      },
      async removeReaction(target, userId) {
        const index = reactions.findIndex(
          (r) =>
            r.communityId === communityId &&
            r.subjectType === target.subjectType &&
            r.subjectId === target.subjectId &&
            r.userId === userId,
        );
        const [removed] = index === -1 ? [] : reactions.splice(index, 1);
        return removed?.id ?? null;
      },
      async adjustLikeCount(target, delta) {
        const row = subject(target);
        if (!row) return 0;
        row.likeCount += delta;
        return row.likeCount;
      },
      async readLikeCount(target) {
        return subject(target)?.likeCount ?? 0;
      },
    };
  }

  return {
    reports,
    drafts,
    follows,
    feedVisits,
    memberEmails,
    posts,
    comments,
    reactions,
    images,
    categories,
    outbox,
    addCommunity(id, privacy = "private") {
      const community = { id: parseCommunityId(id), privacy, archivedAt: null };
      communities.set(community.id, community);
      return community;
    },
    archiveCommunity(id, at = new Date()) {
      const community = communities.get(parseCommunityId(id));
      if (community) {
        communities.set(community.id, { ...community, archivedAt: at });
      }
    },
    addMember(communityId, userId, role = "member", status = "active") {
      members.set(`${communityId}:${userId}`, { role, status });
    },
    addUser(userId, name) {
      users.set(userId, name);
    },
    setUsername(userId, username) {
      usernames.set(userId, username);
    },
    async findCommunity(id) {
      return communities.get(id) ?? null;
    },
    async listDueScheduledPosts(now, limit) {
      return [...posts.values()]
        .filter((p) => p.scheduledAt && !p.deletedAt && p.scheduledAt <= now)
        .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
        .slice(0, limit)
        .map((p) => ({
          id: p.id,
          communityId: parseCommunityId(p.communityId),
          authorId: p.authorId,
        }));
    },
    async inCommunity(communityId, fn) {
      return fn(store(communityId));
    },
  };
}
