import type { CommunityPrivacy, CommunityRole } from "@cohory/authz";
import type { CommunityId, MemberUsage } from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";

import type { AccessSummaryStore } from "./access-summary/store";
import type { CompStore, DueComp } from "./comps/store";
import type { ErasureStore } from "./erasure/store";
import type { ExitStore } from "./exit/store";
import type { DueHold, HoldSettlement, HoldStore } from "./holds/store";
import type { LinkStore } from "./linking/store";
import type { MoveStore, RetentionCutoffs } from "./moves/store";
import type { MetricsStore } from "./metrics/store";
import type { TenureStore } from "./tenure/store";
import type {
  feeLedgerEntries,
  JoinAnswerJson,
  JoinMode,
  JoinQuestion,
  membershipPlans,
  MemberRemovalReason,
  MemberStatus,
  paymentConnections,
  paymentCustomers,
  payments,
  PaymentProvider,
  subscriptions,
  SubscriptionAccessState,
} from "@cohory/db/schema";

export type ConnectionRecord = typeof paymentConnections.$inferSelect;
export type PlanRecord = typeof membershipPlans.$inferSelect;
export type CustomerRecord = typeof paymentCustomers.$inferSelect;
export type SubscriptionRecord = typeof subscriptions.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type LedgerEntryRecord = typeof feeLedgerEntries.$inferSelect;

export const reconcilableStatuses = [
  "active",
  "restricted",
] as const satisfies readonly ConnectionRecord["status"][];

export interface CommunityRecord {
  readonly id: CommunityId;
  readonly slug: string;
  readonly name: string;
  readonly privacy: CommunityPrivacy;
  readonly archived: boolean;
  readonly joinMode: JoinMode;
  readonly joinQuestions: readonly JoinQuestion[];
  readonly imageUrl: string | null;
}

export interface MemberRecord {
  readonly role: CommunityRole;
  readonly status: MemberStatus;
  readonly removalReason: MemberRemovalReason | null;
}

export type NewConnection = Pick<ConnectionRecord, "provider" | "status"> &
  Partial<
    Pick<
      ConnectionRecord,
      | "externalAccountId"
      | "encryptedSecret"
      | "webhookSecretEncrypted"
      | "chargesEnabled"
      | "detailsSubmitted"
      | "livemode"
    >
  > & { readonly id: string; readonly acceptedOwnerId: string };

export type ConnectionPatch = Partial<
  Pick<
    ConnectionRecord,
    | "externalAccountId"
    | "encryptedSecret"
    | "webhookSecretEncrypted"
    | "status"
    | "chargesEnabled"
    | "detailsSubmitted"
    | "livemode"
    | "disconnectedAt"
    | "lastWebhookAt"
    | "acceptedOwnerId"
  >
>;

export type NewPlan = Pick<
  PlanRecord,
  "id" | "connectionId" | "name" | "currency" | "monthlyPriceMinor" | "annualPriceMinor"
>;

export type DraftPrices = Pick<
  PlanRecord,
  "name" | "currency" | "monthlyPriceMinor" | "annualPriceMinor"
>;

export type PlanPatch = Partial<
  Pick<
    PlanRecord,
    "name" | "providerProductId" | "providerMonthlyPriceId" | "providerAnnualPriceId" | "archivedAt"
  >
>;

export type SubscriptionInput = Partial<Pick<SubscriptionRecord, "origin" | "externalPriceId">> &
  Pick<
    SubscriptionRecord,
    | "userId"
    | "customerId"
    | "connectionId"
    | "planId"
    | "externalSubscriptionId"
    | "providerStatus"
    | "accessState"
    | "interval"
    | "currentPeriodEnd"
    | "cancelAtPeriodEnd"
    | "endedAt"
    | "applicationFeeBps"
    | "providerFetchedAt"
  >;

export interface SubscriptionUpsert {
  readonly record: SubscriptionRecord;
  readonly previous: SubscriptionRecord | null;
  readonly applied: boolean;
}

export interface SubscriptionListRow {
  readonly subscription: SubscriptionRecord;
  readonly userName: string;
  readonly userEmail: string;
  readonly plan: Pick<PlanRecord, "currency" | "monthlyPriceMinor" | "annualPriceMinor"> | null;
  readonly connection: Pick<ConnectionRecord, "provider" | "externalAccountId" | "livemode"> | null;
}

export type PaymentInput = Pick<
  PaymentRecord,
  | "subscriptionId"
  | "externalInvoiceId"
  | "externalPaymentIntentId"
  | "currency"
  | "amountMinor"
  | "taxMinor"
  | "occurredAt"
>;

export type LedgerEntryInput = Pick<
  LedgerEntryRecord,
  | "paymentId"
  | "kind"
  | "collectionMethod"
  | "currency"
  | "baseMinor"
  | "rateBps"
  | "computedFeeMinor"
  | "providerFeeMinor"
  | "externalRef"
  | "idempotencyKey"
  | "occurredAt"
> &
  Partial<Pick<LedgerEntryRecord, "reason">> & { readonly provider: PaymentProvider };

export type PaymentDisputePatch = {
  readonly disputeStatus: NonNullable<PaymentRecord["disputeStatus"]>;
  readonly disputedAt: Date;
};

export interface PaymentFeeTotals {
  readonly accruedMinor: number;
  readonly refundedMinor: number;
}

export interface CurrencyTotals {
  readonly currency: string;
  readonly paymentCount: number;
  readonly grossMinor: number;
  readonly refundedMinor: number;
  readonly taxMinor: number;
  readonly platformFeeMinor: number;
  readonly platformFeeRefundedMinor: number;
}

export interface PaymentsStore {
  readonly communityId: CommunityId;
  readonly accessSummary: AccessSummaryStore;
  readonly comps: CompStore;
  readonly erasure: ErasureStore;
  readonly exit: ExitStore;
  readonly holds: HoldStore;
  readonly links: LinkStore;
  readonly moves: MoveStore;
  readonly tenure: TenureStore;
  readonly metrics: MetricsStore;
  findMember(userId: string): Promise<MemberRecord | null>;
  findAccess(userId: string, now: Date): Promise<CommunityAccess>;
  lockMember(userId: string): Promise<MemberRecord | null>;
  activateMember(userId: string, at: Date): Promise<HoldSettlement>;
  removeMember(userId: string): Promise<void>;
  hasOtherGrantingSubscription(userId: string, exceptSubscriptionId: string): Promise<boolean>;
  findEarlierRenewingSubscription(
    subscription: SubscriptionRecord,
  ): Promise<SubscriptionRecord | null>;
  isEmailBanned(userId: string): Promise<boolean>;
  findUserEmail(userId: string): Promise<string | null>;
  findReachableEmail(userId: string): Promise<string | null>;
  isUserEmailConfirmed(userId: string): Promise<boolean>;
  findUserName(userId: string): Promise<string | null>;
  findOwnerId(): Promise<string | null>;
  enableManagement(): Promise<void>;
  acceptCreatorTerms(userId: string, version: string): Promise<void>;
  hasAcceptedCreatorTerms(userId: string, version: string): Promise<boolean>;

  findOpenConnection(): Promise<ConnectionRecord | null>;
  findConnectionClosedAt(connectionId: string): Promise<Date | null>;
  insertConnection(input: NewConnection): Promise<ConnectionRecord>;
  updateConnection(connectionId: string, patch: ConnectionPatch): Promise<ConnectionRecord>;

  findActivePlan(): Promise<PlanRecord | null>;
  findDraftPlan(): Promise<PlanRecord | null>;
  findPlan(planId: string): Promise<PlanRecord | null>;
  findPlanByPrice(providerPriceId: string): Promise<PlanRecord | null>;
  insertPlan(input: NewPlan): Promise<PlanRecord>;
  updatePlan(planId: string, patch: PlanPatch): Promise<PlanRecord>;
  updateDraftPlan(planId: string, prices: DraftPrices): Promise<PlanRecord>;
  setCommunityCurrency(currency: string | null): Promise<void>;
  markTestCheckoutSucceeded(at: Date): Promise<void>;

  findCustomer(userId: string, connectionId: string): Promise<CustomerRecord | null>;
  findCustomerByExternal(
    connectionId: string,
    externalCustomerId: string,
  ): Promise<CustomerRecord | null>;
  upsertCustomer(input: {
    userId: string;
    connectionId: string;
    externalCustomerId: string;
  }): Promise<CustomerRecord>;

  savePendingJoinAnswers(userId: string, answers: readonly JoinAnswerJson[]): Promise<void>;
  memberUsage(userId: string, now: Date): Promise<MemberUsage>;

  findSubscriptionForUser(userId: string): Promise<SubscriptionRecord | null>;
  findSubscription(subscriptionId: string): Promise<SubscriptionRecord | null>;
  findSubscriptionByExternal(externalSubscriptionId: string): Promise<SubscriptionRecord | null>;
  findMirroredExternalIds(externalSubscriptionIds: readonly string[]): Promise<Set<string>>;
  upsertSubscription(input: SubscriptionInput): Promise<SubscriptionUpsert>;
  listSubscriptions(limit: number): Promise<SubscriptionListRow[]>;
  listSubscriptionsWithFee(connectionId: string): Promise<SubscriptionRecord[]>;
  listGrantingExternalIds(connectionId: string): Promise<string[]>;
  setSubscriptionFeeBps(subscriptionId: string, applicationFeeBps: number): Promise<void>;
  setSubscriptionAccessState(
    subscriptionId: string,
    accessState: SubscriptionAccessState,
  ): Promise<void>;

  upsertPayment(input: PaymentInput): Promise<PaymentRecord>;
  findPaymentByIntent(paymentIntentId: string): Promise<PaymentRecord | null>;
  setPaymentRefunded(paymentId: string, refundedMinor: number): Promise<void>;
  lockPaymentByIntent(paymentIntentId: string): Promise<PaymentRecord | null>;
  setPaymentDispute(paymentId: string, dispute: PaymentDisputePatch): Promise<void>;

  insertLedgerEntry(input: LedgerEntryInput): Promise<boolean>;
  accruedFeeTotals(paymentId: string): Promise<PaymentFeeTotals>;
  currencyTotals(): Promise<CurrencyTotals[]>;
}

export interface EventRecordInput {
  readonly provider: PaymentProvider;
  readonly externalEventId: string;
  readonly externalAccountId: string | null;
  readonly connectionId: string | null;
  readonly type: string;
  readonly livemode: boolean;
  readonly payloadHash: string;
  readonly now: Date;
}

export interface RecordedEvent {
  readonly rowId: string;
  readonly processed: boolean;
}

export interface StoredEvent {
  readonly rowId: string;
  readonly externalEventId: string;
  readonly externalAccountId: string | null;
  readonly type: string;
}

export interface StaleEventQuery {
  readonly receivedBefore: Date;
  readonly receivedAfter: Date;
  readonly claimedBefore: Date;
  readonly limit: number;
}

export interface StaleEvent {
  readonly rowId: string;
  readonly connectionId: string | null;
}

export interface AbandonedEvent {
  readonly rowId: string;
  readonly provider: PaymentProvider;
  readonly externalEventId: string;
  readonly type: string;
}

export interface RecordedStripeEvent extends StaleEvent {
  readonly processed: boolean;
}

export const abandonedEventMarker = "abandoned";

export type EventClaim =
  | { readonly kind: "claimed"; readonly event: StoredEvent }
  | { readonly kind: "duplicate" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "missing" };

export interface SealedConnection {
  readonly id: string;
  readonly communityId: CommunityId;
  readonly encryptedSecret: string | null;
  readonly webhookSecretEncrypted: string | null;
}

export interface SealedSecrets {
  readonly encryptedSecret: string | null;
  readonly webhookSecretEncrypted: string | null;
}

export interface ClosedBillingDue {
  readonly communityId: CommunityId;
  readonly subscriptionId: string;
  readonly userId: string;
  readonly closedAt: Date;
  readonly currentPeriodEnd: Date | null;
  readonly accessState: SubscriptionAccessState;
}

export interface DueRenewal {
  readonly communityId: CommunityId;
  readonly subscriptionId: string;
  readonly renewsAt: Date;
}

export interface PaymentsRepository {
  findCommunity(communityId: CommunityId): Promise<CommunityRecord | null>;
  inCommunity<T>(
    communityId: CommunityId,
    userId: string | null,
    fn: (store: PaymentsStore) => Promise<T>,
  ): Promise<T>;
  inCommunityAsSystem<T>(
    communityId: CommunityId,
    fn: (store: PaymentsStore) => Promise<T>,
  ): Promise<T>;

  recordEvent(input: EventRecordInput): Promise<RecordedEvent>;
  claimEvent(rowId: string, now: Date, leaseMs: number): Promise<EventClaim>;
  finishEvent(rowId: string, communityId: CommunityId | null, at: Date): Promise<void>;
  failEvent(rowId: string, message: string): Promise<void>;
  listStaleEvents(input: StaleEventQuery): Promise<StaleEvent[]>;
  listAbandonedEvents(receivedBefore: Date, limit: number): Promise<AbandonedEvent[]>;
  markEventsAbandoned(rowIds: readonly string[]): Promise<void>;
  findStripeEvent(externalEventId: string): Promise<RecordedStripeEvent | null>;
  findConnectionByAccount(externalAccountId: string): Promise<ConnectionRecord | null>;
  findExitedConnectionByAccount(externalAccountId: string): Promise<ConnectionRecord | null>;
  findConnectionById(connectionId: string): Promise<ConnectionRecord | null>;

  activateMembership(communityId: CommunityId, userId: string, at: Date): Promise<void>;
  restoreLeftMembership(communityId: CommunityId, userId: string, at: Date): Promise<boolean>;
  removeMembership(communityId: CommunityId, userId: string): Promise<void>;
  listDueComps(now: Date, limit: number): Promise<DueComp[]>;
  listCommunityIds(after: string | null, limit: number): Promise<string[]>;
  removeExpiredMoves(communityIds: readonly string[], cutoffs: RetentionCutoffs): Promise<number>;
  listDueHolds(now: Date, limit: number): Promise<DueHold[]>;
  listClosedBillingDue(now: Date, limit: number): Promise<ClosedBillingDue[]>;
  listYearlyRenewals(from: Date, to: Date, limit: number): Promise<DueRenewal[]>;
  listReconcilableConnectionIds(afterId: string | null, limit: number): Promise<string[]>;
  listSealedConnections(afterId: string | null, limit: number): Promise<SealedConnection[]>;
  replaceSealedSecrets(connection: SealedConnection, next: SealedSecrets): Promise<boolean>;
}
