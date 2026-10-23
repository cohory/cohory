import { ApprovalRequiredError, assertCan, can, type Actor } from "@cohory/authz";

import { PostNotFoundError } from "../errors";
import type { DraftRecord } from "../repository";
import { toDraftView, type PostView } from "../views";
import {
  isUuid,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Runtime,
} from "./context";
import { agentIdOf, publishPost, type CreatePostResult } from "./posts";

function refuseAgents(actor: Actor, action: "publish" | "discard"): void {
  if (agentIdOf(actor)) {
    throw new ApprovalRequiredError(action, "post_draft", "publishing");
  }
}

async function loadDraft(actor: Actor, access: Access, draftId: string): Promise<DraftRecord> {
  const userId = requireUserId(actor);
  const draft = isUuid(draftId) ? await access.store.findDraft(draftId) : null;
  if (!draft || (draft.authorId !== userId && !can(actor, "pin", "post", access.policy()))) {
    throw new PostNotFoundError();
  }
  return draft;
}

export function createDraftOperations(runtime: Runtime) {
  return {
    async listDrafts(actor: Actor, communityId: string): Promise<PostView[]> {
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "post", access.policy());
        const agentId = agentIdOf(actor);
        const everyone = !agentId && can(actor, "pin", "post", access.policy());
        const rows = await access.store.listDrafts(everyone ? null : userId);
        return rows
          .filter((row) => !agentId || row.agentId === agentId)
          .map((row) => toDraftView(row));
      });
    },

    async publishDraft(
      actor: Actor,
      communityId: string,
      draftId: string,
    ): Promise<CreatePostResult> {
      refuseAgents(actor, "publish");
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "post", access.policy());
        const draft = await loadDraft(actor, access, draftId);
        const result = await publishPost(runtime, actor, access, {
          authorId: draft.authorId,
          agentId: draft.agentId,
          title: draft.title,
          body: draft.body,
          categoryId: draft.categoryId,
        });
        await access.store.deleteDraft(draft.id);
        return result;
      });
    },

    async discardDraft(actor: Actor, communityId: string, draftId: string): Promise<void> {
      refuseAgents(actor, "discard");
      await withAccess(runtime, actor, communityId, async (access) => {
        const draft = await loadDraft(actor, access, draftId);
        await access.store.deleteDraft(draft.id);
      });
    },
  };
}
