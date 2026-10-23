import type { PlanInterval, SubscriptionAccessState } from "@cohory/db/schema";

export interface SubscriptionAccessFact {
  readonly userId: string;
  readonly accessState: SubscriptionAccessState;
  readonly interval: PlanInterval | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | null;
}

export interface CompAccessFact {
  readonly userId: string;
  readonly expiresAt: Date | null;
}

export interface MemberAccessFacts {
  readonly subscriptions: readonly SubscriptionAccessFact[];
  readonly comps: readonly CompAccessFact[];
}

export interface AccessSummaryStore {
  listAccessFacts(userIds: readonly string[] | null, now: Date): Promise<MemberAccessFacts>;
}
