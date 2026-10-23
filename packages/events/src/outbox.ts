import type { Database } from "@cohory/db";
import { outbox } from "@cohory/db/schema";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { setRlsFlag } from "@cohory/db";

export interface PendingOutboxRow {
  readonly id: string;
  readonly communityId: string | null;
  readonly topic: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export type OutboxPublisher = (row: PendingOutboxRow) => Promise<void>;

export interface RelayOptions {
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly now?: () => Date;
}

export interface RelayResult {
  readonly published: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

export class UnknownOutboxTopicError extends Error {
  constructor(readonly topic: string) {
    super(`no publisher for outbox topic ${topic}`);
    this.name = "UnknownOutboxTopicError";
  }
}

export const defaultRelayLimit = 100;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export const relayLeaseMs = 60_000;

async function claimPending(
  db: Database,
  options: RelayOptions,
  now: Date,
  lease: Date,
): Promise<PendingOutboxRow[]> {
  return db.transaction(async (tx) => {
    await setRlsFlag(tx, "outbox_relay");
    const claimable = tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          isNull(outbox.publishedAt),
          or(isNull(outbox.claimedUntil), lte(outbox.claimedUntil, now)),
          options.ids ? inArray(outbox.id, [...options.ids]) : undefined,
        ),
      )
      .orderBy(asc(outbox.createdAt), asc(outbox.id))
      .limit(options.limit ?? defaultRelayLimit)
      .for("update", { skipLocked: true });
    const claimed = await tx
      .update(outbox)
      .set({ claimedUntil: lease })
      .where(inArray(outbox.id, claimable))
      .returning({
        id: outbox.id,
        communityId: outbox.communityId,
        topic: outbox.topic,
        payload: outbox.payload,
        attempts: outbox.attempts,
        createdAt: outbox.createdAt,
      });
    return claimed
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(({ createdAt: _createdAt, ...row }) => row);
  });
}

async function settle(
  db: Database,
  id: string,
  lease: Date,
  values: Pick<typeof outbox.$inferInsert, "publishedAt" | "attempts" | "lastError">,
): Promise<number> {
  return db.transaction(async (tx) => {
    await setRlsFlag(tx, "outbox_relay");
    const result = await tx
      .update(outbox)
      .set({ ...values, claimedUntil: null })
      .where(and(eq(outbox.id, id), eq(outbox.claimedUntil, lease)));
    return result.rowCount ?? 0;
  });
}

export async function relayOutbox(
  db: Database,
  publish: OutboxPublisher,
  options: RelayOptions = {},
): Promise<RelayResult> {
  if (options.ids?.length === 0) {
    return { published: 0, failed: 0, errors: [] };
  }
  const now = options.now ?? (() => new Date());
  const claimedAt = now();
  const lease = new Date(claimedAt.getTime() + relayLeaseMs);
  const pending = await claimPending(db, options, claimedAt, lease);
  let published = 0;
  const errors: string[] = [];
  for (const row of pending) {
    let failure: string | null = null;
    try {
      await publish(row);
    } catch (error: unknown) {
      failure = errorName(error);
    }
    const settled = await settle(db, row.id, lease, {
      publishedAt: failure ? undefined : now(),
      attempts: row.attempts + 1,
      lastError: failure,
    });
    if (settled === 0) {
      continue;
    }
    if (failure) {
      errors.push(failure);
    } else {
      published += 1;
    }
  }
  return { published, failed: errors.length, errors };
}

export interface PruneOptions {
  readonly batchSize?: number;
}

const pruneBatchSize = 5000;

export async function pruneOutbox(
  db: Database,
  publishedBefore: Date,
  options: PruneOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? pruneBatchSize;
  let removed = 0;
  for (;;) {
    const deleted = await db.transaction(async (tx) => {
      await setRlsFlag(tx, "outbox_relay");
      const batch = tx
        .select({ id: outbox.id })
        .from(outbox)
        .where(lt(outbox.publishedAt, publishedBefore))
        .limit(batchSize);
      const result = await tx.delete(outbox).where(inArray(outbox.id, batch));
      return result.rowCount ?? 0;
    });
    removed += deleted;
    if (deleted < batchSize) {
      return removed;
    }
  }
}
