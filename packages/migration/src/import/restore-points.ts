import {
  memberStats,
  pointsLedger,
  pointsSourceTypes,
  type PointsSourceType,
} from "@cohory/db/schema";

import type { MappedId } from "./id-map";
import { date, type RestoreContext } from "./restore-context";

const mappedPointsSources: Partial<Record<PointsSourceType, string>> = {
  reaction: "reactions",
  lesson: "lessons",
  event_occurrence: "event_occurrences",
};

function knownSourceType(value: string | null): PointsSourceType | null {
  return pointsSourceTypes.find((known) => known === value) ?? null;
}

export async function restorePoints(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, user } = ctx;
  await phase(
    "points_ledger",
    records.points_ledger,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      const sources: MappedId[] = [];
      for (const { row, id } of items) {
        const userId = user(row.userId);
        if (!userId) {
          skips.add("points_ledger", row.id, "The person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        const sourceType = knownSourceType(row.sourceType);
        let sourceId: string | null = null;
        if (sourceType && row.sourceId) {
          sourceId =
            map.get(mappedPointsSources[sourceType] ?? "points_source", row.sourceId) ??
            map.get("points_source", row.sourceId) ??
            null;
          if (!sourceId) {
            const entry = map.assign("points_source", row.sourceId);
            sources.push(entry);
            sourceId = entry.targetId;
          }
        }
        values.push({
          id,
          communityId: target,
          userId,
          delta: row.delta,
          reason: row.reason,
          sourceType,
          sourceId,
          occurredAt: date(row.occurredAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(pointsLedger).values(values).onConflictDoNothing();
      }
      await map.persist(tx, sources);
      return skipped;
    },
  );

  await phase(
    "member_stats",
    records.member_stats,
    (row) => row.userId,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row } of items) {
        const userId = user(row.userId);
        if (!userId) {
          skips.add("member_stats", row.userId, "The person is not in the archive.");
          skipped.add(row.userId);
          continue;
        }
        const fields = {
          pointsTotal: row.pointsTotal,
          level: row.level,
          updatedAt: date(row.updatedAt),
        };
        await tx
          .insert(memberStats)
          .values({ communityId: target, userId, ...fields })
          .onConflictDoUpdate({
            target: [memberStats.communityId, memberStats.userId],
            set: fields,
          });
      }
      return skipped;
    },
  );
}
