import type { ScopedQueries } from "@cohory/db";
import { memberStats, pointsLedger } from "@cohory/db/schema";
import { eq, sql, type SQL } from "drizzle-orm";

import { levelThresholds } from "./levels";

export function levelSql(points: SQL): SQL<number> {
  const steps = levelThresholds
    .map((threshold, index) => ({ threshold, level: index + 1 }))
    .filter(({ level }) => level > 1)
    .reverse()
    .map(
      ({ threshold, level }) =>
        sql`when ${points} >= ${sql.raw(String(threshold))} then ${sql.raw(String(level))}`,
    );
  return sql<number>`(case ${sql.join(steps, sql` `)} else 1 end)::smallint`;
}

export interface StatsDelta {
  readonly userId: string;
  readonly delta: number;
  readonly at: Date;
}

export async function applyStatsDeltas(
  { tx, values }: ScopedQueries,
  deltas: readonly StatsDelta[],
): Promise<void> {
  for (const { userId, delta, at } of deltas) {
    const total = sql`${memberStats.pointsTotal} + excluded.points_total`;
    await tx
      .insert(memberStats)
      .values(
        values({
          userId,
          pointsTotal: delta,
          level: levelSql(sql`${delta}::integer`),
          updatedAt: at,
        }),
      )
      .onConflictDoUpdate({
        target: [memberStats.communityId, memberStats.userId],
        set: {
          pointsTotal: total,
          level: levelSql(total),
          updatedAt: sql`greatest(${memberStats.updatedAt}, excluded.updated_at)`,
        },
      });
  }
}

export async function rebuildStats({ tx, where, communityId }: ScopedQueries): Promise<number> {
  await tx.delete(memberStats).where(where(memberStats));
  const total = sql`sum(${pointsLedger.delta})::integer`;
  const rows = await tx
    .insert(memberStats)
    .select(
      tx
        .select({
          communityId: pointsLedger.communityId,
          userId: pointsLedger.userId,
          pointsTotal: total.as("points_total"),
          level: levelSql(total).as("level"),
          updatedAt: sql<Date>`max(${pointsLedger.occurredAt})`.as("updated_at"),
        })
        .from(pointsLedger)
        .where(eq(pointsLedger.communityId, communityId))
        .groupBy(pointsLedger.communityId, pointsLedger.userId),
    )
    .returning({ userId: memberStats.userId });
  return rows.length;
}
