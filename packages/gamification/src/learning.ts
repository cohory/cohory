import type { Database, ScopedQueries } from "@cohory/db";
import { communities, memberships, pointsLedger, type PointsReason } from "@cohory/db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { lastResets, sumByUser } from "./handler";
import { applyStatsDeltas } from "./stats";

export type LearningKind = "lesson" | "event";

export interface LearningActivity {
  readonly kind: LearningKind;
  readonly userId: string;
  readonly sourceId: string;
  readonly occurredAt: Date;
}

export interface LearningPointsCommunity {
  readonly communityId: string;
  readonly lessons: boolean;
  readonly events: boolean;
}

export const learningPointValue = 1;

const ledgerShape: Record<LearningKind, { reason: PointsReason; sourceType: string }> = {
  lesson: { reason: "lesson_completed", sourceType: "lesson" },
  event: { reason: "event_attended", sourceType: "event_occurrence" },
};

export async function listLearningPointsCommunities(
  db: Pick<Database, "select">,
): Promise<LearningPointsCommunity[]> {
  return db
    .select({
      communityId: communities.id,
      lessons: communities.pointsForLessons,
      events: communities.pointsForEvents,
    })
    .from(communities)
    .where(
      and(
        eq(communities.gamificationEnabled, true),
        isNull(communities.deletedAt),
        isNull(communities.archivedAt),
        or(eq(communities.pointsForLessons, true), eq(communities.pointsForEvents, true)),
      ),
    );
}

export async function insertLearningPoints(
  queries: ScopedQueries,
  activities: readonly LearningActivity[],
  makeId: () => string,
): Promise<number> {
  const resets = await lastResets(queries);
  const afterReset = activities.filter(
    (activity) => !resets || activity.occurredAt.getTime() > resets.resetAt(activity.userId),
  );
  const applicable = await newActivitiesOfActiveMembers(queries, afterReset);
  if (applicable.length === 0) return 0;
  const rows = await queries.tx
    .insert(pointsLedger)
    .values(
      applicable.map((activity) =>
        queries.values({
          id: makeId(),
          userId: activity.userId,
          delta: learningPointValue,
          ...ledgerShape[activity.kind],
          sourceId: activity.sourceId,
          occurredAt: activity.occurredAt,
        }),
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
}

function ledgerKey(userId: string, sourceType: string | null, sourceId: string | null): string {
  return `${userId}:${sourceType ?? ""}:${sourceId ?? ""}`;
}

async function newActivitiesOfActiveMembers(
  { tx, where }: ScopedQueries,
  activities: readonly LearningActivity[],
): Promise<LearningActivity[]> {
  if (activities.length === 0) return [];
  const userIds = [...new Set(activities.map((activity) => activity.userId))];
  const active = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      where(memberships, inArray(memberships.userId, userIds), eq(memberships.status, "active")),
    )
    .for("share");
  const activeUsers = new Set(active.map((row) => row.userId));
  const candidates = activities.filter((activity) => activeUsers.has(activity.userId));
  if (candidates.length === 0) return [];
  const recorded = await tx
    .select({
      userId: pointsLedger.userId,
      sourceType: pointsLedger.sourceType,
      sourceId: pointsLedger.sourceId,
    })
    .from(pointsLedger)
    .where(
      where(
        pointsLedger,
        inArray(pointsLedger.userId, [...activeUsers]),
        inArray(pointsLedger.sourceId, [...new Set(candidates.map((a) => a.sourceId))]),
        inArray(
          pointsLedger.sourceType,
          Object.values(ledgerShape).map((shape) => shape.sourceType),
        ),
      ),
    );
  const seen = new Set(recorded.map((row) => ledgerKey(row.userId, row.sourceType, row.sourceId)));
  return candidates.filter((activity) => {
    const key = ledgerKey(
      activity.userId,
      ledgerShape[activity.kind].sourceType,
      activity.sourceId,
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
