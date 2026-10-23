import { ApprovalRequiredError, assertCan, can, type Actor } from "@cohory/authz";

import { collectMentions, extractExcerpt } from "@cohory/content";
import { PostNotFoundError, PostNotScheduledError } from "../errors";
import type { PostEvent } from "../events";
import type { DueScheduledPost, PostRecord } from "../repository";
import {
  scheduledPostsLimit,
  updateScheduledPostInputSchema,
  type UpdateScheduledPostInput,
} from "../schemas";
import { toPostView, type PostView } from "../views";
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
import { categoryForPost } from "./categories";
import { agentIdOf, readPostView } from "./posts";
import { notificationPreview } from "./preview";
import { assertScheduleTime } from "./schedule-time";

export const dueBatchSize = 100;

export interface PublishedPostResult extends Recorded {
  readonly post: PostView;
}

export interface CommittedPublish {
  readonly postId: string;
  readonly outboxId: string;
  readonly events: readonly PostEvent[];
}

export interface PublishDueResult {
  readonly published: readonly CommittedPublish[];
  readonly discarded: number;
  readonly errors: readonly string[];
}

type DueOutcome =
  ({ readonly kind: "published" } & CommittedPublish) | { readonly kind: "discarded" | "skipped" };

async function loadScheduledPost(access: Access, postId: string): Promise<PostRecord> {
  const post = isUuid(postId) ? await access.store.findPost(postId) : null;
  if (!post || post.deletedAt) {
    throw new PostNotFoundError();
  }
  if (!post.scheduledAt) {
    throw new PostNotScheduledError();
  }
  return post;
}

async function publishEvents(
  access: Access,
  post: PostRecord,
): Promise<{ events: PostEvent[]; mentionedUserIds: string[] }> {
  const mentioned = collectMentions(post.body).filter((id) => id !== post.authorId);
  const active = mentioned.length > 0 ? await access.store.filterActiveMembers(mentioned) : null;
  const mentionedUserIds = mentioned.filter((id) => active?.has(id));
  const base = { communityId: access.community.id, postId: post.id, authorId: post.authorId };
  return {
    mentionedUserIds,
    events: [
      { type: "post.created", payload: { ...base, agentId: post.agentId, mentionedUserIds } },
      ...mentionedUserIds.map((mentionedUserId): PostEvent => ({
        type: "mention.created",
        payload: {
          communityId: base.communityId,
          subjectType: "post",
          subjectId: post.id,
          postId: post.id,
          authorId: post.authorId,
          mentionedUserId,
          preview: notificationPreview(post.title, post.bodyText),
        },
      })),
    ],
  };
}

async function publishInCommunity(
  runtime: Runtime,
  access: Access,
  post: PostRecord,
  at: Date,
): Promise<(Recorded & { readonly events: readonly PostEvent[] }) | null> {
  if (!(await access.store.publishScheduledPost(post.id, at))) {
    return null;
  }
  const { events } = await publishEvents(access, post);
  return recordEvents(runtime, access, { events });
}

async function mayPublish(author: Actor, access: Access, post: PostRecord): Promise<boolean> {
  if (access.community.archivedAt || !can(author, "create", "post", access.policy())) {
    return false;
  }
  const category = post.categoryId ? await access.store.findCategory(post.categoryId) : null;
  return !category?.staffOnly || can(author, "post_restricted", "category", access.policy());
}

export function createScheduledOperations(runtime: Runtime) {
  async function publishDue(due: DueScheduledPost, now: Date): Promise<DueOutcome> {
    const author: Actor = { kind: "user", userId: due.authorId, platformAdmin: false };
    return withAccess(runtime, author, due.communityId, async (access) => {
      const post = await access.store.findPost(due.id);
      if (!post?.scheduledAt || post.deletedAt || post.scheduledAt > now) {
        return { kind: "skipped" };
      }
      if (!(await mayPublish(author, access, post))) {
        const discarded = await access.store.discardScheduledPost(post.id, now);
        return { kind: discarded ? "discarded" : "skipped" };
      }
      const recorded = await publishInCommunity(runtime, access, post, now);
      return recorded?.outboxId
        ? {
            kind: "published",
            postId: post.id,
            outboxId: recorded.outboxId,
            events: recorded.events,
          }
        : { kind: "skipped" };
    });
  }

  return {
    async listScheduledPosts(actor: Actor, communityId: string): Promise<PostView[]> {
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "post", access.policy());
        const everyone = can(actor, "read_scheduled", "post", access.policy());
        const rows = await access.store.listScheduledPosts(
          everyone ? null : userId,
          scheduledPostsLimit,
        );
        return rows.map((row) => toPostView(row, runtime.imageUrl));
      });
    },

    async updateScheduledPost(
      actor: Actor,
      communityId: string,
      postId: string,
      input: UpdateScheduledPostInput,
    ): Promise<PostView> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const post = await loadScheduledPost(access, postId);
        assertCan(actor, "edit", "post", access.policy(post.authorId === userId));
        const patch = parseOrThrow(updateScheduledPostInputSchema, input);
        if (patch.scheduledAt && agentIdOf(actor)) {
          throw new ApprovalRequiredError("schedule", "post", "publishing");
        }
        if (patch.scheduledAt) {
          assertScheduleTime(patch.scheduledAt, runtime.now());
          await access.store.reschedulePost(post.id, patch.scheduledAt);
        }
        if (patch.categoryId !== undefined) {
          const category = await categoryForPost(actor, access, patch.categoryId);
          await access.store.updatePostCategory(post.id, category?.id ?? null);
        }
        if (patch.title !== undefined || patch.body !== undefined) {
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
        }
        return readPostView(runtime, access, post.id);
      });
    },

    async cancelScheduledPost(actor: Actor, communityId: string, postId: string): Promise<void> {
      const userId = requireUserId(actor);
      await withAccess(runtime, actor, communityId, async (access) => {
        const post = await loadScheduledPost(access, postId);
        assertCan(actor, "delete", "post", access.policy(post.authorId === userId));
        if (!(await access.store.deleteScheduledPost(post.id))) {
          throw new PostNotScheduledError();
        }
      });
    },

    async publishScheduledPost(
      actor: Actor,
      communityId: string,
      postId: string,
    ): Promise<PublishedPostResult> {
      const userId = requireUserId(actor);
      if (agentIdOf(actor)) {
        throw new ApprovalRequiredError("publish", "post", "publishing");
      }
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const post = await loadScheduledPost(access, postId);
        assertCan(actor, "edit", "post", access.policy(post.authorId === userId));
        assertCan(actor, "create", "post", access.policy());
        const recorded = await publishInCommunity(runtime, access, post, runtime.now());
        if (!recorded) {
          throw new PostNotScheduledError();
        }
        return { ...recorded, post: await readPostView(runtime, access, post.id) };
      });
    },

    async publishDuePosts(limit: number = dueBatchSize): Promise<PublishDueResult> {
      const now = runtime.now();
      const due = await runtime.repo.listDueScheduledPosts(now, limit);
      const published: CommittedPublish[] = [];
      let discarded = 0;
      const errors: string[] = [];
      for (const item of due) {
        try {
          const outcome = await publishDue(item, now);
          if (outcome.kind === "published") {
            published.push({
              postId: outcome.postId,
              outboxId: outcome.outboxId,
              events: outcome.events,
            });
          } else if (outcome.kind === "discarded") {
            discarded += 1;
          }
        } catch (error: unknown) {
          errors.push(error instanceof Error ? error.name : "unknown");
        }
      }
      return { published, discarded, errors };
    },
  };
}
