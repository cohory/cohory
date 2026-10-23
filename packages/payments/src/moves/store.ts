import type { SubscriberMoveSource, subscriberMoves } from "@cohory/db/schema";

export type SubscriberMoveRecord = typeof subscriberMoves.$inferSelect;

export interface SubscriberMoveBatch {
  readonly source: SubscriberMoveSource;
  readonly jobId: string | null;
  readonly createdBy: string;
  readonly rows: readonly { readonly email: string; readonly freeUntil: Date | null }[];
}

export interface MoveStore {
  save(batch: SubscriberMoveBatch, at: Date): Promise<number>;
  list(limit: number): Promise<SubscriberMoveRecord[]>;
  findPendingForUser(userId: string): Promise<SubscriberMoveRecord | null>;
  markResubscribed(userId: string, subscriptionId: string, at: Date): Promise<void>;
  claimReminders(claim: ReminderClaim): Promise<SubscriberMoveRecord[]>;
  count(): Promise<number>;
  lockForAdding(): Promise<void>;
  countListed(emails: readonly string[]): Promise<number>;
  removeExpired(cutoffs: RetentionCutoffs): Promise<number>;
}

export interface ReminderClaim {
  readonly at: Date;
  readonly remindedBefore: Date;
  readonly freeTimeEndedAfter: Date;
  readonly addedAfter: Date;
  readonly limit: number;
}

export interface RetentionCutoffs {
  readonly settledBefore: Date;
  readonly undatedBefore: Date;
}
