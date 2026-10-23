import { setMemberRemovalReason, setRlsFlag, type Database, type ScopedQueries } from "@cohory/db";
import { inviteLinks, membershipHolds, memberships, subscriptions } from "@cohory/db/schema";
import { and, asc, eq, isNull, lte, notInArray, or, sql } from "drizzle-orm";

import type { DueHold, HoldSettlement, HoldStore } from "./store";

const endedStatuses = ["canceled", "incomplete_expired"];

export function createHoldStore(queries: ScopedQueries): HoldStore {
  const { tx, where } = queries;

  async function hasLiveSubscription(userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        where(
          subscriptions,
          eq(subscriptions.userId, userId),
          notInArray(subscriptions.providerStatus, endedStatuses),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async function clear(userId: string): Promise<void> {
    await tx
      .delete(membershipHolds)
      .where(where(membershipHolds, eq(membershipHolds.userId, userId)));
  }

  function lockHold(userId: string) {
    return tx
      .select({
        inviteId: membershipHolds.inviteId,
        expiresAt: membershipHolds.expiresAt,
        releasedAt: membershipHolds.releasedAt,
      })
      .from(membershipHolds)
      .where(where(membershipHolds, eq(membershipHolds.userId, userId)))
      .for("update");
  }

  async function asManager<T>(fn: () => Promise<T>): Promise<T> {
    await setRlsFlag(tx, "community_manager");
    const result = await fn();
    await setRlsFlag(tx, "community_manager", false);
    return result;
  }

  async function takeUse(inviteId: string): Promise<HoldSettlement> {
    const taken = await asManager(() =>
      tx
        .update(inviteLinks)
        .set({ useCount: sql`${inviteLinks.useCount} + 1` })
        .where(
          where(
            inviteLinks,
            eq(inviteLinks.id, inviteId),
            or(isNull(inviteLinks.maxUses), sql`${inviteLinks.useCount} < ${inviteLinks.maxUses}`),
          ),
        )
        .returning({ id: inviteLinks.id }),
    );
    return taken.length > 0
      ? { kind: "use_taken", inviteId }
      : { kind: "invite_exhausted", inviteId };
  }

  return {
    async lock(userId) {
      await lockHold(userId);
    },

    async extend(userId, until) {
      await tx
        .update(membershipHolds)
        .set({ expiresAt: sql`greatest(${membershipHolds.expiresAt}, ${until})` })
        .where(
          where(
            membershipHolds,
            eq(membershipHolds.userId, userId),
            isNull(membershipHolds.releasedAt),
          ),
        );
    },

    async release(userId, now, retryAt) {
      const [hold] = await lockHold(userId);
      if (!hold || hold.releasedAt) {
        return "none";
      }
      if (hold.expiresAt > now) {
        return "kept";
      }
      const [member] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .where(where(memberships, eq(memberships.userId, userId)))
        .for("update");
      if (member?.status !== "pending") {
        await clear(userId);
        return "cleared";
      }
      if (await hasLiveSubscription(userId)) {
        await tx
          .update(membershipHolds)
          .set({ expiresAt: retryAt })
          .where(where(membershipHolds, eq(membershipHolds.userId, userId)));
        return "kept";
      }
      await setMemberRemovalReason(tx, "hold_expired");
      await tx
        .update(memberships)
        .set({ status: "removed", updatedAt: now })
        .where(
          where(memberships, eq(memberships.userId, userId), eq(memberships.status, "pending")),
        );
      await setMemberRemovalReason(tx, null);
      await asManager(() =>
        tx
          .update(inviteLinks)
          .set({ useCount: sql`greatest(${inviteLinks.useCount} - 1, 0)` })
          .where(where(inviteLinks, eq(inviteLinks.id, hold.inviteId))),
      );
      await tx
        .update(membershipHolds)
        .set({ releasedAt: now })
        .where(where(membershipHolds, eq(membershipHolds.userId, userId)));
      return "released";
    },

    async defer(userId, until) {
      await tx
        .update(membershipHolds)
        .set({ expiresAt: until })
        .where(
          where(
            membershipHolds,
            eq(membershipHolds.userId, userId),
            isNull(membershipHolds.releasedAt),
          ),
        );
    },

    async settleOnActivation(userId) {
      const [hold] = await lockHold(userId);
      if (!hold) {
        return { kind: "none" };
      }
      const settled = hold.releasedAt ? await takeUse(hold.inviteId) : { kind: "cleared" as const };
      await clear(userId);
      return settled;
    },
  };
}

export async function listDueHolds(db: Database, now: Date, limit: number): Promise<DueHold[]> {
  return db.transaction(async (tx) => {
    await setRlsFlag(tx, "membership_hold_sweep");
    return tx
      .select({ communityId: membershipHolds.communityId, userId: membershipHolds.userId })
      .from(membershipHolds)
      .where(and(lte(membershipHolds.expiresAt, now), isNull(membershipHolds.releasedAt)))
      .orderBy(asc(membershipHolds.expiresAt))
      .limit(limit);
  });
}
