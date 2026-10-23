import { assertCan, type Actor } from "@cohory/authz";

import { MemberEmailTooSoonError } from "../errors";
import type { MemberEmailRecord } from "../repository";
import { memberEmailIntervalMs } from "../schemas";
import type { MemberEmailStatus } from "../views";
import {
  recordEvents,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Recorded,
  type Runtime,
} from "./context";
import { loadLivePost } from "./posts";

export interface MemberEmailResult extends Recorded {
  readonly sentAt: Date;
}

function nextAvailable(record: MemberEmailRecord | null, now: Date): Date | null {
  if (!record) {
    return null;
  }
  const next = new Date(record.sentAt.getTime() + memberEmailIntervalMs);
  return next > now ? next : null;
}

export function createMemberEmailOperations(runtime: Runtime) {
  return {
    async getMemberEmailStatus(actor: Actor, communityId: string): Promise<MemberEmailStatus> {
      requireUserId(actor);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "email_all", "post", access.policy());
        const record = await access.store.findMemberEmail();
        return {
          lastSentAt: record?.sentAt ?? null,
          nextAvailableAt: nextAvailable(record, runtime.now()),
        };
      });
    },

    async emailPostToMembers(
      actor: Actor,
      communityId: string,
      postId: string,
    ): Promise<MemberEmailResult> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "email_all", "post", access.policy());
        const post = await loadLivePost(access.store, postId);
        const at = runtime.now();
        const since = new Date(at.getTime() - memberEmailIntervalMs);
        if (!(await access.store.claimMemberEmail(at, userId, since))) {
          const next = nextAvailable(await access.store.findMemberEmail(), at);
          throw new MemberEmailTooSoonError(next ?? new Date(at.getTime() + memberEmailIntervalMs));
        }
        return recordEvents(runtime, access, {
          sentAt: at,
          events: [
            {
              type: "post.emailed",
              payload: {
                communityId: access.community.id,
                postId: post.id,
                sentBy: userId,
                occurredAt: at.toISOString(),
              },
            },
          ],
        });
      });
    },
  };
}
