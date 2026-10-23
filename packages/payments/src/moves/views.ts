import type { SubscriberMoveSource } from "@cohory/db/schema";

import type { SubscriberMoveRecord } from "./store";

export type SubscriberMoveState = "not_moved" | "moved" | "free_time_ended";

export interface SubscriberMoveView {
  readonly id: string;
  readonly email: string;
  readonly source: SubscriberMoveSource;
  readonly freeUntil: Date | null;
  readonly state: SubscriberMoveState;
  readonly resubscribedAt: Date | null;
  readonly remindedAt: Date | null;
}

export interface MoveReminder {
  readonly email: string;
  readonly source: SubscriberMoveSource;
  readonly freeUntil: Date | null;
}

export function moveState(record: SubscriberMoveRecord, now: Date): SubscriberMoveState {
  if (record.status === "resubscribed") {
    return "moved";
  }
  return record.freeUntil && record.freeUntil <= now ? "free_time_ended" : "not_moved";
}

export function toSubscriberMoveView(record: SubscriberMoveRecord, now: Date): SubscriberMoveView {
  return {
    id: record.id,
    email: record.email,
    source: record.source,
    freeUntil: record.freeUntil,
    state: moveState(record, now),
    resubscribedAt: record.resubscribedAt,
    remindedAt: record.remindedAt,
  };
}
