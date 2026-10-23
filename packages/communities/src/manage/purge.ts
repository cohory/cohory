import {
  getDb,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import {
  comments,
  communities,
  notifications,
  pointsLedger,
  posts,
  reactions,
} from "@cohory/db/schema";
import { asc, eq, isNotNull, sql } from "drizzle-orm";

import { CommunityDeletionConflictError } from "../errors";
import { paymentsPaidExit, type PaidExitPort } from "./paid-exit";

export const purgeBatchSize = 1000;

export interface PurgeRunLimits {
  readonly candidates: number;
  readonly purges: number;
  readonly budgetMs: number;
}

export const purgeRunLimits: PurgeRunLimits = { candidates: 50, purges: 5, budgetMs: 45_000 };

// Children of posts go first so each post batch cascades into little else.
const batchedTables = [
  { table: comments, id: comments.id, communityId: comments.communityId },
  { table: reactions, id: reactions.id, communityId: reactions.communityId },
  { table: notifications, id: notifications.id, communityId: notifications.communityId },
  { table: pointsLedger, id: pointsLedger.id, communityId: pointsLedger.communityId },
  { table: posts, id: posts.id, communityId: posts.communityId },
] as const;

export interface PurgeDeps {
  readonly db: Database;
  readonly paidExit: Pick<PaidExitPort, "prepareDeletion">;
  readonly now?: () => Date;
  readonly batchSize?: number;
}

export type PurgeOutcome = "purged" | "not_ready" | "not_deleted";

export interface PurgeFailure {
  readonly communityId: CommunityId;
  readonly code: string;
}

export interface PurgeRunResult {
  readonly purged: number;
  readonly notReady: number;
  readonly failed: readonly PurgeFailure[];
}

const checkViolation = "23514";

function isCheckViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === checkViolation) {
      return true;
    }
  }
  return false;
}

async function isMarkedDeleted(db: Database, communityId: CommunityId): Promise<boolean> {
  const [row] = await db
    .select({ deletedAt: communities.deletedAt })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  return row?.deletedAt != null;
}

async function markAttempt(db: Database, communityId: CommunityId, at: Date): Promise<void> {
  await runInCommunity(withCommunity(db, communityId), ({ tx }) =>
    tx.execute(
      sql`update ${communities} set purge_attempted_at = ${at.toISOString()}::timestamptz where ${communities.id} = ${communityId}`,
    ),
  );
}

async function deleteInBatches(
  db: Database,
  communityId: CommunityId,
  batchSize: number,
): Promise<void> {
  for (const { table, id, communityId: column } of batchedTables) {
    for (;;) {
      const deleted = await runInCommunity(withCommunity(db, communityId), async ({ tx }) => {
        await setRlsFlag(tx, "community_purge");
        const result = await tx.execute(
          sql`delete from ${table} where ${id} in (select ${id} from ${table} where ${column} = ${communityId} limit ${batchSize})`,
        );
        return result.rowCount ?? 0;
      });
      if (deleted < batchSize) {
        break;
      }
    }
  }
}

export async function purgeCommunity(
  deps: PurgeDeps,
  communityId: CommunityId,
): Promise<PurgeOutcome> {
  if (!(await isMarkedDeleted(deps.db, communityId))) {
    return "not_deleted";
  }
  await markAttempt(deps.db, communityId, deps.now?.() ?? new Date());
  await deleteInBatches(deps.db, communityId, deps.batchSize ?? purgeBatchSize);
  return runInCommunity(withCommunity(deps.db, communityId), async (queries) => {
    // The cascade of the last delete can outlast the web statement timeout on a large community.
    await queries.tx.execute(sql`set local statement_timeout = 0`);
    const [row] = await queries.tx
      .select({ name: communities.name })
      .from(communities)
      .where(eq(communities.id, communityId))
      .for("update");
    if (!row) {
      return "not_deleted";
    }
    const now = deps.now?.() ?? new Date();
    if (!(await deps.paidExit.prepareDeletion(queries, { communityName: row.name, now }))) {
      return "not_ready";
    }
    try {
      await queries.tx.delete(communities).where(eq(communities.id, communityId));
    } catch (error: unknown) {
      if (isCheckViolation(error)) {
        throw new CommunityDeletionConflictError();
      }
      throw error;
    }
    return "purged";
  });
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    return "code" in error && typeof error.code === "string" ? error.code : error.name;
  }
  return "unknown";
}

export async function purgeDeletedCommunities(
  deps: PurgeDeps,
  limits: PurgeRunLimits = purgeRunLimits,
): Promise<PurgeRunResult> {
  const startedAt = Date.now();
  const rows = await deps.db
    .select({ id: communities.id })
    .from(communities)
    .where(isNotNull(communities.deletedAt))
    .orderBy(
      sql`${communities.purgeAttemptedAt} asc nulls first`,
      asc(communities.deletedAt),
      asc(communities.id),
    )
    .limit(limits.candidates);
  let purged = 0;
  let notReady = 0;
  const failed: PurgeFailure[] = [];
  for (const row of rows) {
    if (purged >= limits.purges || Date.now() - startedAt >= limits.budgetMs) {
      break;
    }
    const communityId = parseCommunityId(row.id);
    try {
      const outcome = await purgeCommunity(deps, communityId);
      if (outcome === "purged") {
        purged += 1;
      } else if (outcome === "not_ready") {
        notReady += 1;
      }
    } catch (error: unknown) {
      failed.push({ communityId, code: errorCode(error) });
    }
  }
  return { purged, notReady, failed };
}

export function purgeDeletedCommunitiesNow(): Promise<PurgeRunResult> {
  return purgeDeletedCommunities({ db: getDb(), paidExit: paymentsPaidExit });
}
