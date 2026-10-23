import type { Database } from "./client";
import { outbox } from "./schema/outbox";
import type { Transaction } from "./tenancy";

export interface OutboxEntry {
  readonly id: string;
  readonly communityId: string | null;
  readonly topic: string;
  readonly payload: object;
}

export async function appendOutbox(tx: Transaction | Database, entry: OutboxEntry): Promise<void> {
  await tx.insert(outbox).values({
    id: entry.id,
    communityId: entry.communityId,
    topic: entry.topic,
    payload: entry.payload,
  });
}
