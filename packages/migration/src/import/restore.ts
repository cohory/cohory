import { contentTypeForKey, parseStorageKey } from "@cohory/storage";

import { restoreAuditLog, restoreCommunity, restoreGallery } from "./restore-community";
import {
  createRestoreContext,
  type RestoreContext,
  type RestoreDeps,
  type RestoreInput,
} from "./restore-context";
import { restoreCourseAgentMaterial, restoreCourses, restoreLessons } from "./restore-courses";
import { restoreEvents } from "./restore-events";
import { restoreCompedMemberships, restoreSubscriptions } from "./restore-payments";
import {
  restoreInviteLinks,
  restoreMembershipRequests,
  restoreMemberships,
  restoreUsers,
} from "./restore-people";
import { restorePoints } from "./restore-points";
import {
  recountPostCounters,
  restoreCategories,
  restoreComments,
  restorePosts,
  restoreReactions,
} from "./restore-posts";
import { restoreReviews } from "./restore-reviews";
import { maxSkippedListed, type ImportSummary } from "./summary";

export { type RestoreDeps, type RestoreInput } from "./restore-context";

async function restoreUploads(ctx: RestoreContext): Promise<number> {
  const { deps, archive, map, skips, scope, progress, rewriteKey } = ctx;
  let restored = 0;
  for (const [key, body] of archive.uploads) {
    if (!map.has("uploads", key)) {
      const next = rewriteKey(key);
      const contentType = next ? contentTypeForKey(next) : null;
      if (!next || !contentType) {
        skips.add("uploads", key, "The file key or type is not allowed.");
      } else {
        await deps.storage.put({ key: parseStorageKey(next), body, contentType });
        await scope(async (tx) => {
          await map.persist(tx, [map.assign("uploads", key)]);
        });
      }
    }
    if (map.has("uploads", key)) restored += 1;
    await progress("uploads", 1);
  }
  for (const key of archive.manifest.missingUploads) {
    skips.add("uploads", key, "The file was missing when the archive was made.");
  }
  return restored;
}

/**
 * Restores an archive into the target community, one phase per entity in dependency order.
 * Every phase skips rows the id map already holds, so a retried job resumes where it stopped.
 */
export async function restoreArchive(
  deps: RestoreDeps,
  input: RestoreInput,
): Promise<ImportSummary> {
  const ctx = await createRestoreContext(deps, input);
  const { records, map, skips, slugs, total } = ctx;

  if (map.size === 0) {
    await deps.onProgress?.({ phase: "users", done: 0, total });
  }

  const users = await restoreUsers(ctx);
  await restoreCommunity(ctx);
  await restoreGallery(ctx);
  const ownerImportedAs = await restoreMemberships(ctx);
  await restoreCategories(ctx);
  await restorePosts(ctx);
  await restoreComments(ctx);
  await restoreReactions(ctx);
  await restoreCourses(ctx);
  await restoreLessons(ctx);
  await restoreCourseAgentMaterial(ctx);
  await restoreEvents(ctx);
  await restorePoints(ctx);
  await restoreCompedMemberships(ctx);
  const subscriptionLinks = await restoreSubscriptions(ctx);
  const renamedInviteLinks = await restoreInviteLinks(ctx);
  await restoreMembershipRequests(ctx);
  await restoreReviews(ctx);
  await restoreAuditLog(ctx);
  const restored = await restoreUploads(ctx);
  await recountPostCounters(ctx);

  const imported: Record<string, number> = {};
  for (const entity of Object.keys(records)) {
    imported[entity] = entity === "subscriptions" ? 0 : map.count(entity);
  }
  imported.users = records.users.filter((row) => map.has("users", row.id)).length;
  imported.subscription_comps = map.count("subscriptions");

  return {
    imported,
    skipped: skips.listed,
    skippedTotal: skips.count,
    users,
    ownerImportedAs,
    renamedInviteLinks,
    renamedSlugs: slugs.renamed.slice(0, maxSkippedListed),
    plans: records.membership_plans,
    subscriptionLinks,
    uploads: { restored, missing: ctx.archive.manifest.missingUploads },
    emailsSent: 0,
  };
}
