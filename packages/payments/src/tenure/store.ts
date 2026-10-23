import type { PlanInterval, SubscriptionAccessState } from "@cohory/db/schema";

export type SubscriptionOrigin = "created_by_cohory" | "linked_import";

export interface SubscriberTenure {
  readonly userId: string;
  readonly providerStatus: string;
  readonly accessState: SubscriptionAccessState;
  readonly interval: PlanInterval | null;
  readonly origin: SubscriptionOrigin;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | null;
  readonly paidSince: Date;
}

export interface TenureStore {
  listTenure(userIds: readonly string[]): Promise<SubscriberTenure[]>;
}
