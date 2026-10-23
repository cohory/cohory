import type { CommunityId } from "@cohory/db";
import type {
  CommunityAppearance,
  PlatformBillingIssueKind,
  PlatformInvoiceCollection,
  PlatformInvoiceStatus,
} from "@cohory/db/schema";

export interface BillingAccountRecord {
  readonly id: string;
  readonly communityId: string;
  readonly stripeCustomerId: string | null;
  readonly billingEmail: string | null;
  readonly paymentMethodId: string | null;
  readonly paymentMethodLabel: string | null;
  readonly suspendedAt: Date | null;
}

export interface PlatformInvoiceRecord {
  readonly id: string;
  readonly communityId: string;
  readonly billingAccountId: string;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly amountMinor: number;
  readonly amountPaidMinor: number;
  readonly status: PlatformInvoiceStatus;
  readonly collectionMethod: PlatformInvoiceCollection;
  readonly stripeInvoiceId: string | null;
  readonly invoiceNumber: string | null;
  readonly hostedInvoiceUrl: string | null;
  readonly dueAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly paidAt: Date | null;
  readonly voidedAt: Date | null;
  readonly pastDueSince: Date | null;
  readonly ownerNotifiedAt: Date | null;
  readonly createdAt: Date;
}

export type InvoicePatch = Partial<
  Pick<
    PlatformInvoiceRecord,
    | "status"
    | "amountPaidMinor"
    | "stripeInvoiceId"
    | "invoiceNumber"
    | "hostedInvoiceUrl"
    | "dueAt"
    | "finalizedAt"
    | "paidAt"
    | "voidedAt"
    | "pastDueSince"
    | "ownerNotifiedAt"
  >
>;

export type AccountPatch = Partial<
  Pick<
    BillingAccountRecord,
    "stripeCustomerId" | "billingEmail" | "paymentMethodId" | "paymentMethodLabel" | "suspendedAt"
  >
>;

export interface BillableBalance {
  readonly communityId: CommunityId;
  readonly currency: string;
  readonly balanceMinor: number;
  readonly entryCount: number;
}

export interface CurrencyBalance {
  readonly currency: string;
  readonly currentMinor: number;
  readonly carriedMinor: number;
}

export interface InvoiceTotals {
  readonly linesMinor: number;
  readonly ledgerMinor: number;
}

export interface BillingIssueRecord {
  readonly id: string;
  readonly invoiceId: string | null;
  readonly kind: PlatformBillingIssueKind;
  readonly currency: string;
  readonly periodStart: Date;
  readonly expectedMinor: number | null;
  readonly actualMinor: number | null;
  readonly detectedAt: Date;
}

export interface IssueInput {
  readonly invoiceId: string | null;
  readonly kind: PlatformBillingIssueKind;
  readonly currency: string;
  readonly periodStart: Date;
  readonly expectedMinor: number | null;
  readonly actualMinor: number | null;
  readonly detectedAt: Date;
}

export interface NewInvoiceInput {
  readonly billingAccountId: string;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly collectionMethod: PlatformInvoiceCollection;
  readonly minimumMinor: number;
}

export type NewInvoiceResult =
  | { readonly kind: "created"; readonly invoice: PlatformInvoiceRecord }
  | { readonly kind: "exists"; readonly invoice: PlatformInvoiceRecord }
  | { readonly kind: "below_minimum"; readonly balanceMinor: number };

export interface BillingStore {
  readonly communityId: CommunityId;
  findAccount(): Promise<BillingAccountRecord | null>;
  ensureAccount(): Promise<BillingAccountRecord>;
  updateAccount(patch: AccountPatch): Promise<BillingAccountRecord>;
  findOwnerEmail(): Promise<string | null>;
  createInvoice(input: NewInvoiceInput): Promise<NewInvoiceResult>;
  findInvoice(invoiceId: string): Promise<PlatformInvoiceRecord | null>;
  findInvoiceByStripe(stripeInvoiceId: string): Promise<PlatformInvoiceRecord | null>;
  updateInvoice(invoiceId: string, patch: InvoicePatch): Promise<PlatformInvoiceRecord>;
  listInvoices(limit: number): Promise<PlatformInvoiceRecord[]>;
  invoiceTotals(invoiceId: string): Promise<InvoiceTotals>;
  ledgerAccruedBase(currency: string, periodStart: Date, periodEnd: Date): Promise<number>;
  balances(currentPeriodStart: Date): Promise<CurrencyBalance[]>;
  hasPeriodicEntries(): Promise<boolean>;
  recordIssue(input: IssueInput): Promise<boolean>;
  resolveIssues(
    currency: string,
    periodStart: Date,
    keep: readonly PlatformBillingIssueKind[],
    at: Date,
  ): Promise<void>;
  listOpenIssues(): Promise<BillingIssueRecord[]>;
  pastDueInvoices(): Promise<PlatformInvoiceRecord[]>;
}

export type CommunityScope = readonly CommunityId[] | undefined;

export interface InvoiceRef {
  readonly communityId: CommunityId;
  readonly invoiceId: string;
}

export interface BillingCommunity {
  readonly name: string;
  readonly slug: string;
  readonly appearance: CommunityAppearance | null;
}

export interface BillingRepository {
  asBilling<T>(communityId: CommunityId, fn: (store: BillingStore) => Promise<T>): Promise<T>;
  asManager<T>(communityId: CommunityId, fn: (store: BillingStore) => Promise<T>): Promise<T>;
  listBillableBalances(periodEnd: Date, scope?: CommunityScope): Promise<BillableBalance[]>;
  listUnsettledInvoices(scope?: CommunityScope): Promise<InvoiceRef[]>;
  listInvoicesSince(periodStart: Date, scope?: CommunityScope): Promise<InvoiceRef[]>;
  listCommunitiesWithAccounts(): Promise<CommunityId[]>;
  findCommunity(communityId: CommunityId): Promise<BillingCommunity | null>;
}
