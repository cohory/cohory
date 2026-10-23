import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";

import { grants, type MembershipAccess } from "../access";
import { PaymentsValidationError } from "../errors";
import { addSubscriberMovesInputSchema, type AddSubscriberMovesInput } from "../moves/schemas";
import type { SubscriberMoveBatch, SubscriberMoveRecord } from "../moves/store";
import type { PaymentsStore } from "../repository";
import { toSubscriberMoveView, type MoveReminder, type SubscriberMoveView } from "../moves/views";
import { parse, requireUserId, withAccess, type Runtime } from "./context";

export const subscriberMoveListLimit = 1000;
export const subscriberMoveCommunityLimit = 5000;
export const moveReminderLimit = 500;
export const movingCompNote = "Free time while moving";

const dayMs = 24 * 60 * 60 * 1000;
// Stripe ends a trial at most two years ahead.
const longestFreeTimeMs = 730 * dayMs;
const reminderGapMs = 7 * dayMs;
const remindAfterFreeTimeMs = 7 * dayMs;
const remindUndatedMs = 30 * dayMs;
const keepSettledMs = 90 * dayMs;
const keepUndatedMs = 120 * dayMs;
const sweepCommunityBatch = 500;
const endGraceMs = 7 * dayMs;

export interface MovingOperations {
  listSubscriberMoves(actor: Actor, communityId: string): Promise<SubscriberMoveView[]>;
  addSubscriberMoves(
    actor: Actor,
    communityId: string,
    input: AddSubscriberMovesInput,
  ): Promise<{ saved: number }>;
  claimMoveReminders(actor: Actor, communityId: string): Promise<MoveReminder[]>;
  sweepSubscriberMoves(): Promise<MoveRetentionResult>;
}

export interface MoveRetentionResult {
  readonly removed: number;
}

// On the Community Edition an imported free membership would otherwise outlast the free
// time the creator set (decision record 0042).
async function endFreeAccessAtMove(
  store: PaymentsStore,
  batch: SubscriberMoveBatch,
  now: Date,
): Promise<void> {
  const earliestEnd = now.getTime() + endGraceMs;
  if (!(await store.findActivePlan())) {
    return;
  }
  for (const row of batch.rows) {
    if (!row.freeUntil) {
      continue;
    }
    const userId = await store.comps.findUserIdByEmail(row.email);
    if (!userId) {
      continue;
    }
    const [member, subscription, comp] = await Promise.all([
      store.findMember(userId),
      store.findSubscriptionForUser(userId),
      store.comps.findOpen(userId),
    ]);
    const expiresAt = new Date(Math.max(row.freeUntil.getTime(), earliestEnd));
    if (comp) {
      if (comp.note === movingCompNote && comp.expiresAt?.getTime() !== expiresAt.getTime()) {
        await store.comps.setExpiry(comp.id, expiresAt, now);
        await store.comps.appendAudit({
          actorId: batch.createdBy,
          action: "comp.expiry_changed",
          target: userId,
          metadata: {
            compId: comp.id,
            from: comp.expiresAt?.toISOString() ?? null,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }
      continue;
    }
    if (member?.status !== "active" || member.role !== "member") {
      continue;
    }
    if (subscription && grants(subscription.accessState) && !subscription.endedAt) {
      continue;
    }
    const inserted = await store.comps.insert({
      userId,
      grantedBy: batch.createdBy,
      note: movingCompNote,
      expiresAt,
    });
    if (inserted) {
      await store.comps.appendAudit({
        actorId: batch.createdBy,
        action: "comp.granted",
        target: userId,
        metadata: {
          compId: inserted.id,
          expiresAt: inserted.expiresAt?.toISOString() ?? null,
          note: true,
        },
      });
    }
  }
}

// Members read their own move before the community scope they check out in: the table is
// readable only with the payments manager or webhook setting.
export async function findPendingMove(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<SubscriberMoveRecord | null> {
  const parsed = communityIdSchema.safeParse(communityId);
  if (!parsed.success) {
    return null;
  }
  return runtime.repo.inCommunityAsSystem(parsed.data, async (store) => {
    const move = await store.moves.findPendingForUser(userId);
    if (!move || (runtime.requireConfirmedEmail && !(await store.isUserEmailConfirmed(userId)))) {
      return null;
    }
    return move;
  });
}

export function movingWindow(
  move: Pick<SubscriberMoveRecord, "freeUntil"> | null,
  access: MembershipAccess,
  now: Date,
): { endsAt: Date } | null {
  if (!move?.freeUntil || move.freeUntil <= now) {
    return null;
  }
  if (access.level === "staff" || access.level === "banned") {
    return null;
  }
  if (access.level === "member" && access.source === "subscription") {
    return null;
  }
  return { endsAt: move.freeUntil };
}

export function createMovingOperations(runtime: Runtime): MovingOperations {
  return {
    async listSubscriberMoves(actor, communityId) {
      const rows = await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "link_subscriptions", "payment", context);
        await store.enableManagement();
        return store.moves.list(subscriberMoveListLimit);
      });
      const now = runtime.now();
      return rows.map((row) => toSubscriberMoveView(row, now));
    },

    async addSubscriberMoves(actor, communityId, input) {
      const createdBy = requireUserId(actor);
      const { source, jobId, rows } = parse(addSubscriberMovesInputSchema, input);
      const now = runtime.now();
      const latest = now.getTime() + longestFreeTimeMs;
      if (rows.some((row) => row.freeUntil && row.freeUntil.getTime() > latest)) {
        throw new PaymentsValidationError([
          { path: "rows", message: "Free time can last up to two years." },
        ]);
      }
      const batch = { source, jobId, createdBy, rows };
      const saved = await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "link_subscriptions", "payment", context);
        await store.enableManagement();
        await store.moves.lockForAdding();
        const emails = rows.map((row) => row.email);
        const added = rows.length - (await store.moves.countListed(emails));
        if ((await store.moves.count()) + added > subscriberMoveCommunityLimit) {
          throw new PaymentsValidationError([
            {
              path: "rows",
              message: `A community can list up to ${subscriberMoveCommunityLimit.toLocaleString("en-US")} people to move.`,
            },
          ]);
        }
        const count = await store.moves.save(batch, now);
        if (runtime.env.edition === "community") {
          await endFreeAccessAtMove(store, batch, now);
        }
        return count;
      });
      return { saved };
    },

    async claimMoveReminders(actor, communityId) {
      requireUserId(actor);
      const now = runtime.now();
      const at = now.getTime();
      const claimed = await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "link_subscriptions", "payment", context);
        await store.enableManagement();
        return store.moves.claimReminders({
          at: now,
          remindedBefore: new Date(at - reminderGapMs),
          freeTimeEndedAfter: new Date(at - remindAfterFreeTimeMs),
          addedAfter: new Date(at - remindUndatedMs),
          limit: moveReminderLimit,
        });
      });
      return claimed.map((row) => ({
        email: row.email,
        source: row.source,
        freeUntil: row.freeUntil && row.freeUntil > now ? row.freeUntil : null,
      }));
    },

    async sweepSubscriberMoves() {
      const at = runtime.now().getTime();
      const cutoffs = {
        settledBefore: new Date(at - keepSettledMs),
        undatedBefore: new Date(at - keepUndatedMs),
      };
      let removed = 0;
      let after: string | null = null;
      for (;;) {
        const ids = await runtime.repo.listCommunityIds(after, sweepCommunityBatch);
        removed += await runtime.repo.removeExpiredMoves(ids, cutoffs);
        if (ids.length < sweepCommunityBatch) {
          break;
        }
        after = ids.at(-1) ?? null;
      }
      if (removed > 0) {
        runtime.log({ msg: "expired moving offers removed", removed });
      }
      return { removed };
    },
  };
}
