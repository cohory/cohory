import { ApprovalRequiredError, assertCan, can, type Actor } from "@cohory/authz";
import { communityKey, validateImage, type ImageUpload } from "@cohory/storage";

import { extractExcerpt } from "@cohory/content";
import { decodeFeedCursor, encodeFeedCursor, feedCursorOf } from "../cursor";
import { CategoryNotFoundError, PinLimitError, PostNotFoundError } from "../errors";
import type { PostEvent } from "../events";
import type { AuthorSummary, PostRecord, PostsStore } from "../repository";
import {
  createPostInputSchema,
  feedInputSchema,
  feedPageSize,
  maxPinnedPosts,
  postImageMaxBytes,
  topWindowDays,
  updatePostInputSchema,
  type CreatePostInput,
  type FeedInput,
  type UpdatePostInput,
} from "../schemas";
import { toDraftView, toPostView, type DeletionView, type Page, type PostView } from "../views";
import { categoryForPost } from "./categories";
import { resolveReportsOnDelete } from "./reports";
import { isLivePost } from "./live";
import { notificationPreview } from "./preview";
import { assertScheduleTime } from "./schedule-time";
import {
  isUuid,
  parseOrThrow,
  prepareContent,
  recordEvents,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Recorded,
  type Runtime,
} from "./context";

const dayMs = 24 * 60 * 60 * 1000;

export interface CreatePostResult extends Recorded {
  readonly post: PostView;
  readonly mentionedUserIds: readonly string[];
}

export type DeleteResult = Recorded;

export interface UploadedPostImage {
  readonly key: string;
  readonly url: string;
  readonly contentType: string;
  readonly size: number;
}

export function canSeeScheduled(actor: Actor, access: Access, post: PostRecord): boolean {
  return (
    access.viewerId === post.authorId || can(actor, "read_scheduled", "post", access.policy(false))
  );
}

export async function loadLivePost(store: PostsStore, postId: string): Promise<PostRecord> {
  const post = isUuid(postId) ? await store.findPost(postId) : null;
  if (!post || !isLivePost(post)) {
    throw new PostNotFoundError();
  }
  return post;
}

export async function deletionOf(
  store: PostsStore,
  record: { readonly deletedAt: Date | null; readonly deletedBy: string | null },
  names: Map<string, AuthorSummary | null> = new Map(),
): Promise<DeletionView | null> {
  if (!record.deletedAt) {
    return null;
  }
  const by = record.deletedBy;
  if (by && !names.has(by)) {
    names.set(by, await store.findUserSummary(by));
  }
  return { at: record.deletedAt, by: by ? (names.get(by) ?? null) : null };
}

export async function loadPostForReader(
  actor: Actor,
  access: Access,
  postId: string,
): Promise<PostRecord> {
  const post = isUuid(postId) ? await access.store.findPost(postId) : null;
  if (
    !post ||
    (post.deletedAt && !can(actor, "read_deleted", "post", access.policy())) ||
    (post.scheduledAt && !canSeeScheduled(actor, access, post))
  ) {
    throw new PostNotFoundError();
  }
  return post;
}

export async function readPostView(
  runtime: Runtime,
  access: Access,
  postId: string,
): Promise<PostView> {
  const row = isUuid(postId) ? await access.store.getPostRow(postId, access.viewerId) : null;
  if (!row || row.deletedAt) {
    throw new PostNotFoundError();
  }
  return toPostView(row, runtime.imageUrl);
}

export function agentIdOf(actor: Actor): string | null {
  return actor.kind === "user" ? (actor.credential?.agentId ?? null) : null;
}

export interface PostDraftInput {
  readonly authorId: string;
  readonly agentId: string | null;
  readonly title?: string | null | undefined;
  readonly body: unknown;
  readonly categoryId?: string | null | undefined;
  readonly scheduledAt?: Date | null | undefined;
}

export async function publishPost(
  runtime: Runtime,
  actor: Actor,
  access: Access,
  input: PostDraftInput,
): Promise<CreatePostResult> {
  const category = await categoryForPost(actor, access, input.categoryId);
  const prepared = await prepareContent(runtime, access, input.body, {
    allowImages: true,
    authorId: input.authorId,
  });
  const id = runtime.newId();
  await access.store.insertPost(
    {
      id,
      authorId: input.authorId,
      agentId: input.agentId,
      categoryId: category?.id ?? null,
      title: input.title ?? null,
      excerpt: extractExcerpt(prepared.content.body),
      scheduledAt: input.scheduledAt ?? null,
      createdAt: runtime.now(),
      ...prepared.content,
    },
    prepared.images,
  );
  if (input.scheduledAt) {
    return recordEvents(runtime, access, {
      post: await readPostView(runtime, access, id),
      mentionedUserIds: [],
      events: [],
    });
  }
  const events: PostEvent[] = [
    {
      type: "post.created",
      payload: {
        communityId: access.community.id,
        postId: id,
        authorId: input.authorId,
        agentId: input.agentId,
        mentionedUserIds: prepared.mentionedUserIds,
      },
    },
    ...prepared.mentionedUserIds.map((mentionedUserId): PostEvent => ({
      type: "mention.created",
      payload: {
        communityId: access.community.id,
        subjectType: "post",
        subjectId: id,
        postId: id,
        authorId: input.authorId,
        mentionedUserId,
        preview: notificationPreview(input.title ?? null, prepared.content.bodyText),
      },
    })),
  ];
  return recordEvents(runtime, access, {
    post: await readPostView(runtime, access, id),
    mentionedUserIds: prepared.mentionedUserIds,
    events,
  });
}

async function createDraft(
  runtime: Runtime,
  actor: Actor,
  access: Access,
  input: PostDraftInput,
): Promise<CreatePostResult> {
  const category = await categoryForPost(actor, access, input.categoryId);
  const prepared = await prepareContent(runtime, access, input.body, {
    allowImages: true,
    authorId: input.authorId,
  });
  const id = runtime.newId();
  await access.store.insertDraft({
    id,
    authorId: input.authorId,
    agentId: input.agentId,
    categoryId: category?.id ?? null,
    title: input.title ?? null,
    excerpt: extractExcerpt(prepared.content.body),
    createdAt: runtime.now(),
    ...prepared.content,
  });
  const [row] = (await access.store.listDrafts(input.authorId)).filter((draft) => draft.id === id);
  if (!row) {
    throw new PostNotFoundError();
  }
  return { post: toDraftView(row), mentionedUserIds: [], events: [], outboxId: null };
}

export function createPostOperations(runtime: Runtime) {
  return {
    async createPost(
      actor: Actor,
      communityId: string,
      input: CreatePostInput,
    ): Promise<CreatePostResult> {
      const userId = requireUserId(actor);
      runtime.rateLimit("post", userId);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "post", access.policy());
        const parsed = parseOrThrow(createPostInputSchema, input);
        const agentId = agentIdOf(actor);
        if (agentId) {
          if (parsed.scheduledAt) {
            throw new ApprovalRequiredError("schedule", "post", "publishing");
          }
          return createDraft(runtime, actor, access, { ...parsed, authorId: userId, agentId });
        }
        if (parsed.scheduledAt) {
          assertScheduleTime(parsed.scheduledAt, runtime.now());
        }
        return publishPost(runtime, actor, access, { ...parsed, authorId: userId, agentId: null });
      });
    },

    async updatePost(
      actor: Actor,
      communityId: string,
      postId: string,
      input: UpdatePostInput,
    ): Promise<PostView> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const post = await loadLivePost(access.store, postId);
        assertCan(actor, "edit", "post", access.policy(post.authorId === userId));
        const patch = parseOrThrow(updatePostInputSchema, input);
        const prepared =
          patch.body === undefined
            ? {
                content: { body: post.body, bodyHtml: post.bodyHtml, bodyText: post.bodyText },
                images: null,
              }
            : await prepareContent(runtime, access, patch.body, {
                allowImages: true,
                authorId: userId,
              });
        await access.store.updatePostContent(
          post.id,
          {
            ...prepared.content,
            title: patch.title === undefined ? post.title : patch.title,
            excerpt: extractExcerpt(prepared.content.body),
            editedAt: runtime.now(),
          },
          prepared.images ?? null,
        );
        return readPostView(runtime, access, post.id);
      });
    },

    async deletePost(actor: Actor, communityId: string, postId: string): Promise<DeleteResult> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const post = await loadLivePost(access.store, postId);
        assertCan(actor, "delete", "post", access.policy(post.authorId === userId));
        const likes = await access.store.listLikesOnPost(post.id);
        const at = runtime.now();
        await access.store.softDeletePost(post.id, at, userId);
        await resolveReportsOnDelete(
          { actor, access, userId, at },
          { type: "post", postId: post.id },
        );
        return recordEvents(runtime, access, {
          events: [
            {
              type: "post.deleted",
              payload: {
                communityId: access.community.id,
                postId: post.id,
                authorId: post.authorId,
                occurredAt: at.toISOString(),
                likes,
              },
            },
          ],
        });
      });
    },

    async pinPost(actor: Actor, communityId: string, postId: string): Promise<PostView> {
      requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "pin", "post", access.policy());
        const post = await loadLivePost(access.store, postId);
        if (!post.pinnedAt) {
          await access.store.lockPins();
          if ((await access.store.countPinned()) >= maxPinnedPosts) {
            throw new PinLimitError(maxPinnedPosts);
          }
          await access.store.setPinnedAt(post.id, runtime.now());
        }
        return readPostView(runtime, access, post.id);
      });
    },

    async unpinPost(actor: Actor, communityId: string, postId: string): Promise<PostView> {
      requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "pin", "post", access.policy());
        const post = await loadLivePost(access.store, postId);
        if (post.pinnedAt) {
          await access.store.setPinnedAt(post.id, null);
        }
        return readPostView(runtime, access, post.id);
      });
    },

    async getPost(actor: Actor, communityId: string, postId: string): Promise<PostView> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "post", access.policy());
        const post = await loadPostForReader(actor, access, postId);
        if (!post.deletedAt) {
          return readPostView(runtime, access, post.id);
        }
        const row = await access.store.getPostRow(post.id, access.viewerId);
        if (!row) {
          throw new PostNotFoundError();
        }
        return toPostView(row, runtime.imageUrl, await deletionOf(access.store, row));
      });
    },

    async listFeed(
      actor: Actor,
      communityId: string,
      input: FeedInput = {},
    ): Promise<Page<PostView>> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "post", access.policy());
        const {
          cursor,
          limit = feedPageSize,
          category,
          sort,
        } = parseOrThrow(feedInputSchema, input);
        const after = cursor ? decodeFeedCursor(cursor, sort) : null;
        const filter = category ? await access.store.findCategoryBySlug(category) : null;
        if (category && !filter) {
          throw new CategoryNotFoundError();
        }
        const rows = await access.store.listFeed(access.viewerId, {
          sort,
          topSince: new Date(runtime.now().getTime() - topWindowDays * dayMs),
          categoryId: filter?.id ?? null,
          after,
          limit: limit + 1,
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          data: page.map((row) => toPostView(row, runtime.imageUrl)),
          nextCursor:
            rows.length > limit && last ? encodeFeedCursor(feedCursorOf(sort, last)) : null,
        };
      });
    },

    async uploadPostImage(
      actor: Actor,
      communityId: string,
      upload: ImageUpload,
    ): Promise<UploadedPostImage> {
      requireUserId(actor);
      const id = await withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "post", access.policy());
        return access.community.id;
      });
      const image = validateImage(upload, postImageMaxBytes);
      await runtime.uploadGuard(id, image.size);
      const key = communityKey(id, "posts", `${runtime.newId()}.${image.extension}`);
      await runtime.storage.put({ key, body: upload.bytes, contentType: image.contentType });
      return {
        key,
        url: runtime.storage.publicUrl(key),
        contentType: image.contentType,
        size: image.size,
      };
    },
  };
}
