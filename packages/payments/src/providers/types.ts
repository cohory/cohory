import type { PaymentDisputeStatus, PaymentProvider as ProviderId } from "@cohory/db/schema";

import type {
  AccountState,
  CancellationDetails,
  ConnectedAccountInput,
  OnboardingLinkInput,
  PauseInput,
  PortalFlow,
  GatewaySubscription,
  GatewaySubscriptionSummary,
  SubscriptionPage,
  SubscriptionPageInput,
  VerifiedEvent,
} from "../gateway";

export type { ProviderId };

export interface ProviderCapabilities {
  readonly supportsFeeSplit: boolean;
  readonly supportsSubscriptions: boolean;
  readonly supportsSubscriptionImport: boolean;
  readonly supportsHostedCheckout: boolean;
  readonly supportsCustomerPortal: boolean;
  readonly supportsRefundApi: boolean;
  readonly emitsDisputeEvents: boolean;
  readonly currencies: readonly string[] | "any";
}

export interface Connection {
  readonly id: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly externalAccountId: string | null;
  readonly livemode: boolean;
  readonly apiCredential: string | null;
  readonly webhookSecret: string | null;
}

export interface StoredEventRef {
  readonly eventId: string;
  readonly accountId: string | null;
}

export interface RawWebhook {
  readonly rawBody: string;
  readonly header: (name: string) => string | null;
}

export type ProviderSubscription = GatewaySubscription;
export type ProviderSubscriptionSummary = GatewaySubscriptionSummary;

export interface ProviderPayment {
  readonly externalId: string;
  readonly subscriptionId: string | null;
  readonly paymentRef: string | null;
  readonly currency: string;
  readonly amountMinor: number;
  readonly taxMinor: number;
  readonly paidAt: Date | null;
}

export interface ProviderRefund {
  readonly chargeRef: string;
  readonly paymentRef: string | null;
  readonly chargedMinor: number;
  readonly refundedMinor: number;
  readonly paymentRefundedMinor: number;
  readonly platformFeeId: string | null;
}

export interface PlatformFeeRefund {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly createdAt: Date;
  readonly disputeId: string | null;
}

export interface ProviderDispute {
  readonly id: string;
  readonly status: PaymentDisputeStatus;
  readonly chargeRef: string;
  readonly paymentRef: string | null;
  readonly currency: string;
  readonly disputedMinor: number;
  readonly chargedMinor: number;
  readonly refundedMinor: number;
  readonly platformFeeId: string | null;
  readonly openedAt: Date;
}

export interface PlatformFee {
  readonly id: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly amount: number;
  readonly amountRefunded: number;
  readonly currency: string;
  readonly createdAt: Date;
  readonly refunds: readonly PlatformFeeRefund[];
}

export interface ProviderPaymentFailure {
  readonly invoiceRef: string;
  readonly subscriptionRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly attempt: number;
  readonly nextAttemptAt: Date | null;
}

export type NormalizedEvent =
  | {
      readonly kind: "checkout_completed";
      readonly subscriptionId: string;
      readonly userIdHint: string | null;
    }
  | { readonly kind: "checkout_expired"; readonly userIdHint: string | null }
  | { readonly kind: "subscription_changed"; readonly subscriptionId: string }
  | { readonly kind: "payment_succeeded"; readonly payment: ProviderPayment }
  | { readonly kind: "payment_refunded"; readonly refund: ProviderRefund }
  | { readonly kind: "payment_failed"; readonly failure: ProviderPaymentFailure }
  | {
      readonly kind: "platform_fee_reported";
      readonly fee: PlatformFee;
      readonly chargedMinor: number;
      readonly paymentRef: string | null;
    }
  | { readonly kind: "dispute_changed"; readonly dispute: ProviderDispute }
  | { readonly kind: "fraud_warning"; readonly chargeRef: string | null }
  | { readonly kind: "account_updated" }
  | { readonly kind: "account_deauthorized" };

export type NormalizedEventKind = NormalizedEvent["kind"];

export interface CheckoutRequest {
  readonly priceId: string;
  readonly customerId: string | null;
  readonly customerEmail: string | null;
  readonly clientReferenceId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly platformFeeBps: number;
  readonly trialEnd: Date | null;
  readonly expiresAt: Date;
  readonly submitMessage: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly idempotencyKey: string;
}

export interface CheckoutMatch {
  readonly keepExternalId: string;
  readonly customerId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PlanProvisioning {
  readonly planId: string;
  readonly communityId: string;
  readonly name: string;
  readonly currency: string;
  readonly monthlyPriceMinor: number;
  readonly annualPriceMinor: number | null;
  readonly imageUrl: string | null;
  readonly productId: string | null;
  readonly monthlyPriceId: string | null;
  readonly annualPriceId: string | null;
}

export interface ProvisionedPlan {
  readonly productId: string;
  readonly monthlyPriceId: string;
  readonly annualPriceId: string | null;
}

export interface RefundResult {
  readonly id: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
}

export interface PlatformFeeOperations {
  isFeeEvent(type: string): boolean;
  get(feeId: string, conn: Connection): Promise<PlatformFee>;
  refund(
    feeId: string,
    amountMinor: number,
    idempotencyKey: string,
    conn: Connection,
    disputeId: string | null,
  ): Promise<void>;
}

// Services read the setup, never the provider id, so a new provider only declares how it is
// connected (docs/architecture/payments.md section 8.1).
export type ConnectionSetup = "platform_account" | "own_keys" | "access_token";

export interface PlatformWebhooks {
  isConfigured(): boolean;
  accountOf(event: VerifiedEvent): string | null;
  acceptsAfterDisconnect(type: string): boolean;
}

export interface HostedOnboarding {
  platformCountry(): Promise<string | null>;
  createAccount(input: ConnectedAccountInput, idempotencyKey: string): Promise<AccountState>;
  createLink(input: OnboardingLinkInput, idempotencyKey: string): Promise<{ url: string }>;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly setup: ConnectionSetup;
  readonly applicationId?: string | null;
  capabilities(conn: Connection | null): ProviderCapabilities;
  expectsLiveEvents(conn: Connection | null): boolean;
  readonly platformWebhooks?: PlatformWebhooks;
  hostedOnboarding?(): HostedOnboarding;
  verifyWebhook(request: RawWebhook, conn: Connection | null): VerifiedEvent;
  normalizeEvent(event: VerifiedEvent, conn: Connection): Promise<NormalizedEvent[] | null>;
  retrieveEvent?(ref: StoredEventRef, conn: Connection): Promise<VerifiedEvent>;
  getAccountState(conn: Connection): Promise<AccountState>;
  provisionPlan(plan: PlanProvisioning, conn: Connection): Promise<ProvisionedPlan>;
  retirePrice(priceId: string, idempotencyKey: string, conn: Connection): Promise<void>;
  renameProduct?(
    productId: string,
    name: string,
    idempotencyKey: string,
    conn: Connection,
  ): Promise<void>;
  createCheckout(
    input: CheckoutRequest,
    conn: Connection,
  ): Promise<{ url: string; externalId: string }>;
  expireOtherCheckouts?(
    match: CheckoutMatch,
    idempotencyKeyPrefix: string,
    conn: Connection,
  ): Promise<void>;
  paidPaymentRefs?(subscriptionId: string, conn: Connection): Promise<string[]>;
  createPortalSession(
    customerId: string,
    returnUrl: string,
    idempotencyKey: string,
    conn: Connection,
    flow?: PortalFlow,
  ): Promise<{ url: string }>;
  pauseSubscription?(
    id: string,
    input: PauseInput,
    idempotencyKey: string,
    conn: Connection,
  ): Promise<ProviderSubscription>;
  resumeSubscription?(
    id: string,
    idempotencyKey: string,
    conn: Connection,
  ): Promise<ProviderSubscription>;
  recordCancellationDetails?(
    id: string,
    details: CancellationDetails,
    idempotencyKey: string,
    conn: Connection,
  ): Promise<void>;
  getSubscription(id: string, conn: Connection): Promise<ProviderSubscription>;
  cancelSubscription(
    id: string,
    opts: {
      readonly atPeriodEnd: boolean;
      readonly idempotencyKey: string;
      readonly comment?: string;
    },
    conn: Connection,
  ): Promise<ProviderSubscription>;
  refund(
    paymentRef: string,
    amount: number | "full",
    idempotencyKey: string,
    conn: Connection,
  ): Promise<RefundResult>;
  deleteCustomer?(customerId: string, idempotencyKey: string, conn: Connection): Promise<void>;
  listSubscriptions?(conn: Connection, page: SubscriptionPageInput): Promise<SubscriptionPage>;
  getSubscriptionSummary?(id: string, conn: Connection): Promise<ProviderSubscriptionSummary>;
  listFeeActivity?(conn: Connection, since: Date): Promise<NormalizedEvent[]>;
  setPlatformFee?(
    subscriptionId: string,
    rateBps: number,
    idempotencyKey: string,
    conn: Connection,
  ): Promise<ProviderSubscription>;
  readonly platformFees?: PlatformFeeOperations;
  signTestEvent?(conn: Connection, eventId: string, at: Date): SignedTestEvent;
}

export interface SignedTestEvent {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
}
