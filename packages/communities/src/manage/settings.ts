import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { newId, parseCommunityId, type Community, type CommunityId } from "@cohory/db";
import { DeletionBlockedByBillingError } from "@cohory/payments";
import { limitsFor, summarizeUsage, type CommunityUsage } from "@cohory/fair-use";
import { communityPrefix, parseStorageKey, storedImageKeys } from "@cohory/storage";
import { logger } from "@cohory/infra/logger";

import { CommunityNotArchivedError, MembershipNotFoundError } from "../errors";
import { fairUseTier } from "../fair-use";
import { isBrandingKey } from "./appearance";
import { inManagedCommunity, parseInput, requireUser, type Managed, type Runtime } from "./context";
import type { CommunityPatch, ManageStore } from "./repository";
import type { ArchiveInput } from "./paid-exit";
import {
  archiveInputSchema,
  deleteCommunityInputSchema,
  updateSettingsInputSchema,
  type DeleteCommunityInput,
  type UpdateSettingsInput,
} from "./schemas";
import { toSettingsView, type ManageSettingsView, type OverviewStats } from "./views";

const weekMs = 7 * 24 * 60 * 60 * 1000;

export type DeleteOutcome = { readonly kind: "deleted" } | { readonly kind: "deleting" };

export type CompletedDeletion = "deleted" | "not_ready";

function assertDeletable(actor: Actor, managed: Managed): void {
  assertCan(actor, "delete", "community", managed.context);
  if (!managed.community.archivedAt) {
    throw new CommunityNotArchivedError();
  }
}

function changedFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = Object.keys(patch).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(patch[key]),
  );
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, patch[key]])),
  };
}

// Payment is the approval while a plan is on sale (decision 0037).
function withPaidJoinMode(patch: CommunityPatch, community: Community): CommunityPatch {
  return community.currency !== null && patch.joinMode === "approval"
    ? { ...patch, joinMode: "open" }
    : patch;
}

export function settingsOperations(runtime: Runtime) {
  return {
    getSettings(actor: Actor, communityId: string): Promise<ManageSettingsView> {
      return inManagedCommunity(runtime, actor, communityId, async ({ community, context }) => {
        assertCan(actor, "read", "settings", context);
        return toSettingsView(community);
      });
    },

    getOverviewStats(actor: Actor, communityId: string): Promise<OverviewStats> {
      return inManagedCommunity(runtime, actor, communityId, async ({ context, store }) => {
        assertCan(actor, "read", "settings", context);
        const now = runtime.now();
        return store.overviewCounts(now, new Date(now.getTime() - weekMs));
      });
    },

    getUsage(actor: Actor, communityId: string): Promise<CommunityUsage> {
      return inManagedCommunity(
        runtime,
        actor,
        communityId,
        async ({ community, context, store }) => {
          assertCan(actor, "read", "settings", context);
          const tier = await fairUseTier(
            (since) => store.hasPaidTransactionSince(since),
            runtime.now(),
          );
          const [members, storageBytes] = await Promise.all([
            store.countActiveMembers(),
            runtime.storage.usedBytes(communityPrefix(community.id)),
          ]);
          return summarizeUsage(tier, limitsFor(runtime.fairUse(), tier), {
            members,
            storageBytes,
          });
        },
      );
    },

    updateSettings(
      actor: Actor,
      communityId: string,
      input: UpdateSettingsInput,
    ): Promise<ManageSettingsView> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "update", "settings", managed.context);
        const parsed: CommunityPatch = parseInput(updateSettingsInputSchema, input);
        const patch = withPaidJoinMode(parsed, managed.community);
        const diff = changedFields({ ...managed.community }, { ...patch });
        if (Object.keys(diff.after).length === 0) {
          return toSettingsView(managed.community);
        }
        const updated = await managed.store.updateCommunity(patch);
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "settings.updated",
          target: managed.community.id,
          metadata: diff,
        });
        return toSettingsView(updated);
      });
    },

    transferOwnership(
      actor: Actor,
      communityId: string,
      newOwnerUserId: string,
    ): Promise<ManageSettingsView> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "transfer_ownership", "community", managed.context);
        if (newOwnerUserId === managed.user.userId) {
          throw new ForbiddenError("transfer_ownership", "community");
        }
        const target = await managed.store.findMember(newOwnerUserId);
        if (!target || target.status !== "active") {
          throw new MembershipNotFoundError();
        }
        await managed.store.setRole(managed.user.userId, "admin");
        await managed.store.setRole(newOwnerUserId, "owner");
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "community.ownership_transferred",
          target: newOwnerUserId,
          metadata: { from: managed.user.userId, to: newOwnerUserId, previousRole: target.role },
        });
        await managed.store.appendMembershipEvents([
          {
            type: "ownership.transferred",
            payload: {
              communityId: managed.community.id,
              noticeId: newId(),
              previousOwnerId: managed.user.userId,
              newOwnerId: newOwnerUserId,
            },
          },
        ]);
        return toSettingsView(managed.community);
      });
    },

    async archiveCommunity(
      actor: Actor,
      communityId: string,
      input: ArchiveInput = {},
    ): Promise<ManageSettingsView> {
      const { paidMembers, includeLinked } = parseInput(archiveInputSchema, input);
      const view = await setArchived(actor, communityId, true);
      await runtime.paidExit.beginArchive({
        communityId: parseCommunityId(view.id),
        actorId: requireUser(actor).userId,
        choice: paidMembers,
        includeLinked,
      });
      return view;
    },

    unarchiveCommunity(actor: Actor, communityId: string): Promise<ManageSettingsView> {
      return setArchived(actor, communityId, false);
    },

    async deleteCommunity(
      actor: Actor,
      communityId: string,
      input: DeleteCommunityInput = {},
    ): Promise<DeleteOutcome> {
      const options = parseInput(deleteCommunityInputSchema, input);
      const id = await inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertDeletable(actor, managed);
        return parseCommunityId(managed.community.id);
      });
      const actorId = requireUser(actor).userId;
      const start = await runtime.paidExit.beginDeletion({ communityId: id, actorId, ...options });
      if (start.kind === "queued" && !(await runtime.paidExit.deletionReady(id))) {
        return { kind: "deleting" };
      }
      const keys = await inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertDeletable(actor, managed);
        return removeCommunity(managed.store, managed.community);
      });
      return (await finishDeletion(keys)) ? { kind: "deleted" } : { kind: "deleting" };
    },

    async completeCommunityDeletion(communityId: CommunityId): Promise<CompletedDeletion> {
      if (!(await runtime.paidExit.deletionReady(communityId))) {
        return "not_ready";
      }
      try {
        const keys = await runtime.repo.inCommunity(communityId, {}, async (store) => {
          const community = await store.findCommunity();
          if (!community?.archivedAt) {
            return null;
          }
          return removeCommunity(store, community);
        });
        return (await finishDeletion(keys)) ? "deleted" : "not_ready";
      } catch (error: unknown) {
        if (error instanceof DeletionBlockedByBillingError) {
          return "not_ready";
        }
        throw error;
      }
    },
  };

  async function removeCommunity(
    store: ManageStore,
    community: Community,
  ): Promise<readonly string[] | null> {
    const gallery = await store.listGallery();
    const deleted = await store.deleteCommunity((queries) =>
      runtime.paidExit.prepareDeletion(queries, {
        communityName: community.name,
        now: runtime.now(),
      }),
    );
    if (!deleted) {
      return null;
    }
    const { logoKey, coverKey } = community.appearance;
    return [
      ...gallery.flatMap((item) => (item.storageKey ? [item.storageKey] : [])),
      ...[logoKey, coverKey].filter((key): key is string => !!key && isBrandingKey(key)),
    ];
  }

  async function finishDeletion(keys: readonly string[] | null): Promise<boolean> {
    if (keys === null) {
      return false;
    }
    await deleteStoredFiles(runtime, keys);
    return true;
  }

  function setArchived(
    actor: Actor,
    communityId: string,
    archived: boolean,
  ): Promise<ManageSettingsView> {
    return inManagedCommunity(runtime, actor, communityId, async (managed) => {
      assertCan(actor, "archive", "community", managed.context);
      if (archived === (managed.community.archivedAt !== null)) {
        return toSettingsView(managed.community);
      }
      const updated = await managed.store.updateCommunity({
        archivedAt: archived ? runtime.now() : null,
      });
      await managed.store.appendAudit({
        actorId: managed.user.userId,
        action: archived ? "community.archived" : "community.unarchived",
        target: managed.community.id,
      });
      return toSettingsView(updated);
    });
  }
}

export { assertCommunityWritable as assertNotArchived } from "../archive";

async function deleteStoredFiles(runtime: Runtime, keys: readonly string[]): Promise<void> {
  for (const key of keys.flatMap((stored) => storedImageKeys(parseStorageKey(stored)))) {
    try {
      await runtime.storage.delete(key);
    } catch (error: unknown) {
      logger.warn(
        { name: error instanceof Error ? error.name : "unknown" },
        "file of a deleted community was not deleted",
      );
    }
  }
}
