import { compedMemberships } from "@cohory/db/schema";

import { paidThrough } from "./paid-through";
import { date, dateOrNull, type RestoreContext } from "./restore-context";
import type { PendingSubscriptionLink } from "./summary";

const compNoteLimit = 200;

export async function restoreCompedMemberships(ctx: RestoreContext): Promise<void> {
  const { records, target, skips, phase, user } = ctx;
  await phase(
    "comped_memberships",
    records.comped_memberships,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const userId = user(row.userId);
        if (!userId) {
          skips.add("comped_memberships", row.id, "The person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        await tx
          .insert(compedMemberships)
          .values({
            id,
            communityId: target,
            userId,
            grantedBy: user(row.grantedBy) ?? null,
            note: row.note,
            expiresAt: dateOrNull(row.expiresAt),
            endedAt: dateOrNull(row.endedAt),
            endReason: row.endReason,
            endedBy: user(row.endedBy) ?? null,
            createdAt: date(row.createdAt),
          })
          .onConflictDoNothing();
      }
      return skipped;
    },
  );
}

/**
 * A paid subscription cannot move between payment accounts, so each one that still grants access
 * becomes a comp until its paid period ends. Returns the links the creator can follow up on.
 */
export async function restoreSubscriptions(
  ctx: RestoreContext,
): Promise<PendingSubscriptionLink[]> {
  const { deps, input, records, target, map, phase, user } = ctx;
  const openComps = new Set(
    records.comped_memberships
      .filter((row) => row.endedAt === null)
      .map((row) => user(row.userId))
      .filter((id): id is string => id !== undefined),
  );
  const subscriptionLinks: PendingSubscriptionLink[] = [];
  const emailOf = new Map(records.users.map((row) => [row.id, row.email]));
  await phase(
    "subscriptions",
    records.subscriptions,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const userId = user(row.userId);
        const grants =
          (row.accessState === "granted" || row.accessState === "grace") && !row.endedAt;
        if (!userId || !grants || openComps.has(userId)) {
          skipped.add(row.id);
          continue;
        }
        await tx
          .insert(compedMemberships)
          .values({
            id,
            communityId: target,
            userId,
            grantedBy: input.ownerUserId,
            note: `Imported paid subscription ${row.externalSubscriptionId}`.slice(
              0,
              compNoteLimit,
            ),
            expiresAt: paidThrough(row.currentPeriodEnd, deps.now()),
          })
          .onConflictDoNothing();
        openComps.add(userId);
      }
      return skipped;
    },
  );
  for (const row of records.subscriptions) {
    const userId = user(row.userId);
    if (!userId) continue;
    subscriptionLinks.push({
      userId,
      email: emailOf.get(row.userId) ?? "",
      externalSubscriptionId: row.externalSubscriptionId,
      externalCustomerId: row.externalCustomerId,
      planId: row.planId,
      providerStatus: row.providerStatus,
      accessState: row.accessState,
      interval: row.interval,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      compId: map.get("subscriptions", row.id) ?? null,
    });
  }
  return subscriptionLinks;
}
