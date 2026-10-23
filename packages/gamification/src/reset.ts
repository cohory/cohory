import { appendAuditEntry, type ScopedQueries } from "@cohory/db";
import { memberStats, pointsLedger } from "@cohory/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

export const pointsResetSourceType = "points_reset";
export const memberPointsResetSourceType = "points_reset_member";

export const resetPointsInputSchema = z.strictObject({
  confirmation: z.string().max(200),
});

export type ResetPointsInput = z.input<typeof resetPointsInputSchema>;

export interface PointsResetResult {
  readonly members: number;
  readonly points: number;
}

interface ResetInput {
  readonly actorId: string;
  readonly at: Date;
  readonly makeId: () => string;
}

export function resetAllPoints(
  queries: ScopedQueries,
  input: ResetInput,
): Promise<PointsResetResult> {
  return resetPoints(queries, input, null);
}

export function resetMemberPoints(
  queries: ScopedQueries,
  input: ResetInput & { readonly userId: string },
): Promise<PointsResetResult> {
  return resetPoints(queries, input, input.userId);
}

async function resetPoints(
  queries: ScopedQueries,
  input: ResetInput,
  userId: string | null,
): Promise<PointsResetResult> {
  const { tx, where, values, communityId } = queries;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`cohory.points.reset:${communityId}`}, 0))`,
  );
  const scope = userId
    ? and(ne(memberStats.pointsTotal, 0), eq(memberStats.userId, userId))
    : ne(memberStats.pointsTotal, 0);
  const rows = await tx
    .select({ userId: memberStats.userId, points: memberStats.pointsTotal })
    .from(memberStats)
    .where(where(memberStats, scope))
    .for("update");
  if (rows.length > 0) {
    await tx.insert(pointsLedger).values(
      rows.map((row) =>
        values({
          id: input.makeId(),
          userId: row.userId,
          delta: -row.points,
          reason: "admin_reset" as const,
          sourceType: userId ? memberPointsResetSourceType : pointsResetSourceType,
          sourceId: input.makeId(),
          occurredAt: input.at,
        }),
      ),
    );
    await tx
      .update(memberStats)
      .set({ pointsTotal: 0, level: 1, updatedAt: input.at })
      .where(where(memberStats, scope));
  }
  const result = {
    members: rows.length,
    points: rows.reduce((sum, row) => sum + row.points, 0),
  };
  await appendAuditEntry(queries, {
    actorId: input.actorId,
    action: userId ? "points.reset_member" : "points.reset",
    target: userId ?? communityId,
    metadata: result,
    at: input.at,
  });
  return result;
}
