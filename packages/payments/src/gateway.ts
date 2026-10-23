import type { PlanInterval } from "@cohory/db/schema";

export interface AccountState {
  readonly id: string;
  readonly chargesEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly livemode: boolean;
  readonly country: string | null;
}

export interface GatewaySubscription {
  readonly id: string;
  readonly status: string;
  readonly customerId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly endedAt: Date | null;
  readonly interval: PlanInterval | null;
  readonly applicationFeePercent: number | null;
  readonly priceId: string | null;
  readonly cancellationComment?: string | null;
}

export interface GatewaySubscriptionSummary {
  readonly id: string;
  readonly status: string;
  readonly customerId: string;
  readonly customerEmail: string | null;
  readonly customerName: string | null;
  readonly priceId: string | null;
  readonly unitAmountMinor: number | null;
  readonly currency: string;
  readonly interval: string | null;
  readonly intervalCount: number;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly createdByApplication: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly applicationFeePercent: number | null;
}

export interface SubscriptionPage {
  readonly items: readonly GatewaySubscriptionSummary[];
  readonly nextCursor: string | null;
}

export interface SubscriptionPageInput {
  readonly startingAfter: string | null;
  readonly limit: number;
}

export interface ChargePageInput {
  readonly createdSince: Date;
  readonly startingAfter: string | null;
  readonly limit: number;
}

export interface GatewayInvoice {
  readonly id: string;
  readonly subscriptionId: string | null;
  readonly status: string | null;
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly attemptCount: number;
  readonly nextPaymentAttemptAt: Date | null;
  readonly taxMinor: number;
  readonly currency: string;
  readonly paymentIntentIds: readonly string[];
  readonly paidAt: Date | null;
}

export interface GatewayCharge {
  readonly id: string;
  readonly amount: number;
  readonly amountRefunded: number;
  readonly currency: string;
  readonly paymentIntentId: string | null;
  readonly applicationFeeId: string | null;
}

export interface GatewayFeeRefund {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly createdAt: Date;
  readonly disputeId: string | null;
}

export interface GatewayDispute {
  readonly id: string;
  readonly chargeId: string;
  readonly paymentIntentId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: Date;
}

export interface GatewayApplicationFee {
  readonly id: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly amount: number;
  readonly amountRefunded: number;
  readonly currency: string;
  readonly createdAt: Date;
  readonly refunds: readonly GatewayFeeRefund[];
}

export interface CheckoutInput {
  readonly priceId: string;
  readonly customerId: string | null;
  readonly customerEmail: string | null;
  readonly clientReferenceId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly applicationFeePercent: number | null;
  readonly trialEnd: Date | null;
  readonly expiresAt: Date | null;
  readonly submitMessage: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export type PortalFlow =
  | { readonly type: "subscription_cancel"; readonly subscriptionId: string }
  | {
      readonly type: "subscription_update_confirm";
      readonly subscriptionId: string;
      readonly priceId: string;
    };

export type CancellationFeedback =
  | "customer_service"
  | "low_quality"
  | "missing_features"
  | "other"
  | "switched_service"
  | "too_complex"
  | "too_expensive"
  | "unused";

export interface CancellationDetails {
  readonly feedback: CancellationFeedback | null;
  readonly comment: string | null;
}

export interface PauseInput {
  readonly resumesAt: Date;
  readonly paidThrough: Date;
}

export interface PriceInput {
  readonly productId: string;
  readonly currency: string;
  readonly unitAmount: number;
  readonly interval: PlanInterval;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface OnboardingLinkInput {
  readonly accountId: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
}

export interface ConnectedAccountInput {
  readonly displayName: string;
  readonly email: string | null;
  readonly country: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface RefundInput {
  readonly paymentIntentId: string;
  readonly amountMinor: number | null;
}

export interface GatewayRefund {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
}

export type StripeAccount = string | null;

export interface CheckoutSessionMatch {
  readonly metadata: Readonly<Record<string, string>>;
  readonly customerId: string | null;
  readonly keepSessionId: string;
}

export interface StripeGateway {
  createConnectedAccount(
    input: ConnectedAccountInput,
    idempotencyKey: string,
  ): Promise<AccountState>;
  retrieveConnectedAccount(accountId: string): Promise<AccountState>;
  createOnboardingLink(
    input: OnboardingLinkInput,
    idempotencyKey: string,
  ): Promise<{ url: string }>;
  retrieveOwnAccount(): Promise<AccountState>;
  createProduct(
    account: StripeAccount,
    input: {
      name: string;
      images?: readonly string[];
      metadata: Readonly<Record<string, string>>;
    },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  createPrice(
    account: StripeAccount,
    input: PriceInput,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  updateProduct(
    account: StripeAccount,
    productId: string,
    input: { name: string },
    idempotencyKey: string,
  ): Promise<void>;
  deactivatePrice(account: StripeAccount, priceId: string, idempotencyKey: string): Promise<void>;
  createCheckoutSession(
    account: StripeAccount,
    input: CheckoutInput,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string }>;
  expireOpenCheckoutSessions(
    account: StripeAccount,
    match: CheckoutSessionMatch,
    idempotencyKeyPrefix: string,
  ): Promise<string[]>;
  createPortalSession(
    account: StripeAccount,
    input: { customerId: string; returnUrl: string; flow?: PortalFlow },
    idempotencyKey: string,
  ): Promise<{ url: string }>;
  pauseSubscription(
    account: StripeAccount,
    subscriptionId: string,
    input: PauseInput,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;
  resumeSubscription(
    account: StripeAccount,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;
  setCancellationDetails(
    account: StripeAccount,
    subscriptionId: string,
    details: CancellationDetails,
    idempotencyKey: string,
  ): Promise<void>;
  retrieveSubscription(
    account: StripeAccount,
    subscriptionId: string,
  ): Promise<GatewaySubscription>;
  listSubscriptions(
    account: StripeAccount,
    input: SubscriptionPageInput,
  ): Promise<SubscriptionPage>;
  retrieveSubscriptionSummary(
    account: StripeAccount,
    subscriptionId: string,
  ): Promise<GatewaySubscriptionSummary>;
  setSubscriptionApplicationFee(
    account: StripeAccount,
    subscriptionId: string,
    percent: number,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;
  retrieveEvent(account: StripeAccount, eventId: string): Promise<VerifiedEvent>;
  retrieveInvoice(account: StripeAccount, invoiceId: string): Promise<GatewayInvoice>;
  listPaidInvoices(account: StripeAccount, subscriptionId: string): Promise<GatewayInvoice[]>;
  retrieveCharge(account: StripeAccount, chargeId: string): Promise<GatewayCharge>;
  listCharges(
    account: StripeAccount,
    input: ChargePageInput,
  ): Promise<{ items: GatewayCharge[]; nextCursor: string | null }>;
  retrieveApplicationFee(feeId: string): Promise<GatewayApplicationFee>;
  retrieveDispute(account: StripeAccount, disputeId: string): Promise<GatewayDispute>;
  refundApplicationFee(
    feeId: string,
    amountMinor: number,
    idempotencyKey: string,
    disputeId: string | null,
  ): Promise<void>;
  clearSubscriptionApplicationFee(
    account: StripeAccount,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;
  cancelSubscription(
    account: StripeAccount,
    subscriptionId: string,
    idempotencyKey: string,
    comment?: string,
  ): Promise<GatewaySubscription>;
  scheduleCancellation(
    account: StripeAccount,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<GatewaySubscription>;
  createRefund(
    account: StripeAccount,
    input: RefundInput,
    idempotencyKey: string,
  ): Promise<GatewayRefund>;
  deleteCustomer(account: StripeAccount, customerId: string, idempotencyKey: string): Promise<void>;
}

export interface VerifiedEvent {
  readonly id: string;
  readonly type: string;
  readonly account: string | null;
  readonly livemode: boolean;
  readonly object: Readonly<Record<string, unknown>> & { readonly id: string };
}

export type WebhookVerifier = (
  rawBody: string,
  signature: string,
  secrets: readonly string[],
) => VerifiedEvent;
