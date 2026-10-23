import type { CommunityId } from "@cohory/db";
import type {
  PaymentProvider,
  paymentExitChoice,
  paymentExitKind,
  paymentExitRuns,
  paymentExitStatus,
} from "@cohory/db/schema";

import type { SubscriptionOrigin } from "../tenure/store";
import type { NoticeScope, PaidMembershipEvent } from "./events";

export type ExitKind = (typeof paymentExitKind.enumValues)[number];
export type ExitChoice = (typeof paymentExitChoice.enumValues)[number];
export type ExitRunStatus = (typeof paymentExitStatus.enumValues)[number];
export type ExitRunRecord = typeof paymentExitRuns.$inferSelect;

export type NewExitRun = Pick<
  ExitRunRecord,
  | "id"
  | "kind"
  | "choice"
  | "connectionId"
  | "includeLinked"
  | "requestedBy"
  | "portalLoginUrl"
  | "manualCancellationConfirmedAt"
  | "targetCount"
> & { readonly status?: ExitRunStatus };

export type ExitRunPatch = Partial<
  Pick<ExitRunRecord, "status" | "attempts" | "doneCount" | "failedSubscriptionIds" | "finishedAt">
>;

export const exitEligibleStatuses = ["active", "trialing", "past_due", "unpaid"] as const;

export interface ExitSubscription {
  readonly id: string;
  readonly userId: string;
  readonly connectionId: string;
  readonly externalSubscriptionId: string;
  readonly origin: SubscriptionOrigin;
  readonly providerStatus: string;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly applicationFeeBps: number;
}

export interface ExitCounts {
  readonly cohory: number;
  readonly linkedImports: number;
}

export interface FinancialSnapshot {
  readonly communityId: CommunityId;
  readonly communityName: string;
}

export interface DetachResult {
  readonly payments: number;
  readonly ledgerEntries: number;
  readonly invoices: number;
}

export interface ExitSubscriptionMember {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly name: string;
}

export interface FeeBalance {
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly balanceMinor: number;
}

export interface BillingBlockers {
  readonly unpaidInvoices: number;
  readonly openBalances: readonly FeeBalance[];
}

export interface FeeWriteOff {
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly amountMinor: number;
  readonly occurredAt: Date;
}

export interface ExitStore {
  insertRun(input: NewExitRun): Promise<ExitRunRecord>;
  findRun(runId: string): Promise<ExitRunRecord | null>;
  findUnfinishedRun(): Promise<ExitRunRecord | null>;
  latestRun(kind: ExitKind): Promise<ExitRunRecord | null>;
  updateRun(runId: string, patch: ExitRunPatch): Promise<ExitRunRecord>;
  listExitSubscriptions(connectionId: string | null): Promise<ExitSubscription[]>;
  countExitSubscriptions(connectionId: string | null): Promise<ExitCounts>;
  detachFinancialRecords(snapshot: FinancialSnapshot): Promise<DetachResult>;
  appendNotices(events: readonly PaidMembershipEvent[], scope: NoticeScope): Promise<void>;
  setCancelAtPeriodEnd(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<void>;
  listSubscriptionMembers(subscriptionIds: readonly string[]): Promise<ExitSubscriptionMember[]>;
  hasClosedConnection(): Promise<boolean>;
  billingBlockers(): Promise<BillingBlockers>;
  writeOffFeeBalance(input: FeeWriteOff): Promise<boolean>;
  listDeferredRemovals(since: Date): Promise<string[]>;
}
