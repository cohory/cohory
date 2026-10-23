import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { z } from "zod";

import type { FollowState } from "../views";
import { requireUserId, withAccess, withWriteAccess, type Access, type Runtime } from "./context";
import { loadLivePost } from "./posts";

const postIdSchema = z.uuid();

function assertCanFollow(actor: Actor, access: Access): void {
  assertCan(actor, "read", "post", access.policy());
  if (!access.role) {
    throw new ForbiddenError("follow", "post");
  }
}

export function createFollowOperations(runtime: Runtime) {
  return {
    async followPost(actor: Actor, communityId: string, postId: string): Promise<FollowState> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCanFollow(actor, access);
        const post = await loadLivePost(access.store, postId);
        await access.store.followPost(post.id, userId, runtime.now());
        return { following: true };
      });
    },

    async unfollowPost(actor: Actor, communityId: string, postId: string): Promise<FollowState> {
      const userId = requireUserId(actor);
      const parsed = postIdSchema.safeParse(postId);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "unfollow", "post", access.policy());
        if (parsed.success) {
          await access.store.unfollowPost(parsed.data, userId);
        }
        return { following: false };
      });
    },

    async getFeedVisit(actor: Actor, communityId: string): Promise<Date | null> {
      if (actor.kind !== "user") {
        return null;
      }
      return withAccess(runtime, actor, communityId, async (access) =>
        access.role ? access.store.findFeedVisit(actor.userId) : null,
      );
    },

    async recordFeedVisit(actor: Actor, communityId: string): Promise<void> {
      if (actor.kind !== "user") {
        return;
      }
      await withAccess(runtime, actor, communityId, async (access) => {
        if (access.role) {
          await access.store.recordFeedVisit(actor.userId, runtime.now());
        }
      });
    },
  };
}
