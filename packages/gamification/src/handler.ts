import {
  newId,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { pointsLedger } from "@cohory/db/schema";
import type { PostEvent } from "@cohory/posts";
import { eq, inArray, max } from "drizzle-orm";

import { pointEntriesFor, reactionSource, type PointEntry } from "./points";
import { memberPointsResetSourceType } from "./reset";
import { applyStatsDeltas, type StatsDelta } from "./stats";

export interface PointsResult {
  readonly inserted: number;
}

function groupByCommunity(entries: readonly PointEntry[]): Map<string, PointEntry[]> {
  const groups = new Map<string, PointEntry[]>();
  for (const entry of entries) {
    groups.set(entry.communityId, [...(groups.get(entry.communityId) ?? []), entry]);
  }
  return groups;
}

export interface ResetTimes {
  resetAt(userId: string): number;
}

// A community reset covers everyone; a member reset covers only that member.
export async function lastResets(queries: ScopedQueries): Promise<ResetTimes | null> {
  const resets = await queries.tx
    .select({
      userId: pointsLedger.userId,
      sourceType: pointsLedger.sourceType,
      at: max(pointsLedger.occurredAt),
    })
    .from(pointsLedger)
    .where(queries.where(pointsLedger, eq(pointsLedger.reason, "admin_reset")))
    .groupBy(pointsLedger.userId, pointsLedger.sourceType);
  if (resets.length === 0) return null;
  let communityReset = 0;
  const memberReset = new Map<string, number>();
  for (const reset of resets) {
    const at = reset.at?.getTime() ?? 0;
    if (reset.sourceType === memberPointsResetSourceType) {
      memberReset.set(reset.userId, Math.max(memberReset.get(reset.userId) ?? 0, at));
    } else {
      communityReset = Math.max(communityReset, at);
    }
  }
  return {
    resetAt: (userId) => Math.max(communityReset, memberReset.get(userId) ?? 0),
  };
}

// A reset already took back every point awarded before it, so reversing one of those
// awards afterwards would charge the member twice.
async function withoutPreResetReversals(
  queries: ScopedQueries,
  entries: readonly PointEntry[],
): Promise<PointEntry[]> {
  const reversed = entries.filter((entry) => entry.delta < 0).map((entry) => entry.sourceId);
  if (reversed.length === 0) return [...entries];
  const resets = await lastResets(queries);
  if (!resets) return [...entries];
  const awards = await queries.tx
    .select({
      sourceId: pointsLedger.sourceId,
      userId: pointsLedger.userId,
      occurredAt: pointsLedger.occurredAt,
    })
    .from(pointsLedger)
    .where(
      queries.where(
        pointsLedger,
        eq(pointsLedger.sourceType, reactionSource),
        eq(pointsLedger.reason, "like_received"),
        inArray(pointsLedger.sourceId, reversed),
      ),
    );
  const skip = new Set(
    awards
      .filter((award) => award.occurredAt.getTime() <= resets.resetAt(award.userId))
      .map((award) => award.sourceId),
  );
  return entries.filter((entry) => entry.delta > 0 || !skip.has(entry.sourceId));
}

export function sumByUser(rows: readonly { userId: string; delta: number; occurredAt: Date }[]) {
  const totals = new Map<string, StatsDelta>();
  for (const row of rows) {
    const current = totals.get(row.userId);
    totals.set(row.userId, {
      userId: row.userId,
      delta: (current?.delta ?? 0) + row.delta,
      at: current && current.at > row.occurredAt ? current.at : row.occurredAt,
    });
  }
  return [...totals.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

export async function recordPoints(
  db: Database,
  events: readonly PostEvent[],
  makeId: () => string = newId,
): Promise<PointsResult> {
  let inserted = 0;
  for (const [communityId, entries] of groupByCommunity(pointEntriesFor(events))) {
    const scope = withCommunity(db, parseCommunityId(communityId));
    inserted += await runInCommunity(scope, async (queries) => {
      const applicable = await withoutPreResetReversals(queries, entries);
      if (applicable.length === 0) return 0;
      const rows = await queries.tx
        .insert(pointsLedger)
        .values(
          applicable.map(({ communityId: _ignored, ...entry }) =>
            queries.values({ id: makeId(), ...entry }),
          ),
        )
        .onConflictDoNothing()
        .returning({
          userId: pointsLedger.userId,
          delta: pointsLedger.delta,
          occurredAt: pointsLedger.occurredAt,
        });
      await applyStatsDeltas(queries, sumByUser(rows));
      return rows.length;
    });
  }
  return { inserted };
}
