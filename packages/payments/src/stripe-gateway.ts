import Stripe from "stripe";
import { z } from "zod";

import { assertApiBaseUrlAllowed } from "./config";
import {
  createPortal,
  paidThroughKey,
  pause,
  recordCancellationDetails,
  resume,
} from "./stripe-member-billing";
import type {
  AccountState,
  GatewayApplicationFee,
  GatewayCharge,
  GatewayDispute,
  GatewayInvoice,
  GatewaySubscription,
  GatewaySubscriptionSummary,
  StripeAccount,
  StripeGateway,
  VerifiedEvent,
  WebhookVerifier,
} from "./gateway";

export class WebhookSignatureError extends Error {
  constructor() {
    super("webhook signature is invalid");
    this.name = "WebhookSignatureError";
  }
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.id;
}

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function requestOptions(account: StripeAccount, idempotencyKey?: string): Stripe.RequestOptions {
  return {
    ...(account ? { stripeAccount: account } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function v2AccountState(account: Stripe.V2.Core.Account): AccountState {
  const cardPayments = account.configuration?.merchant?.capabilities?.card_payments?.status;
  const requirements = account.requirements?.summary?.minimum_deadline?.status;
  return {
    id: account.id,
    chargesEnabled: cardPayments === "active",
    detailsSubmitted: requirements !== "currently_due" && requirements !== "past_due",
    livemode: account.livemode,
    country: account.identity?.country ?? null,
  };
}

function v1AccountState(account: Stripe.Account): AccountState {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    livemode: false,
    country: account.country ?? null,
  };
}

function pausedThrough(subscription: Stripe.Subscription, periodEnd: Date | null): Date | null {
  const stored = subscription.metadata?.[paidThroughKey];
  const parsed = stored ? new Date(stored) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : periodEnd;
}

// A collection pause keeps Stripe's status active while the periods roll on unpaid, so the
// mirror reads it as "paused" with access only through the period paid before the pause.
function isPaused(subscription: Stripe.Subscription): boolean {
  return (
    Boolean(subscription.pause_collection) &&
    (subscription.status === "active" || subscription.status === "trialing")
  );
}

export function subscriptionOf(subscription: Stripe.Subscription): GatewaySubscription {
  const item = subscription.items.data[0];
  const interval = item?.price.recurring?.interval;
  const customerId = idOf(subscription.customer);
  if (!customerId) {
    throw new Error("subscription has no customer");
  }
  const paused = isPaused(subscription);
  const itemPeriodEnd = fromUnix(item?.current_period_end);
  const periodEnd = paused ? pausedThrough(subscription, itemPeriodEnd) : itemPeriodEnd;
  const cancelAt = fromUnix(subscription.cancel_at);
  const endsEarly = cancelAt !== null && subscription.status !== "canceled";
  return {
    id: subscription.id,
    status: paused ? "paused" : subscription.status,
    customerId,
    metadata: subscription.metadata,
    currentPeriodEnd:
      endsEarly && (periodEnd === null || cancelAt < periodEnd) ? cancelAt : periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || endsEarly,
    endedAt: fromUnix(subscription.ended_at),
    interval: interval === "month" ? "month" : interval === "year" ? "year" : null,
    applicationFeePercent: subscription.application_fee_percent,
    priceId: item?.price.id ?? null,
    cancellationComment: subscription.cancellation_details?.comment ?? null,
  };
}

function customerContact(customer: Stripe.Subscription["customer"]): {
  email: string | null;
  name: string | null;
} {
  if (typeof customer === "string" || customer.deleted) {
    return { email: null, name: null };
  }
  return { email: customer.email ?? null, name: customer.name ?? null };
}

export function subscriptionSummaryOf(
  subscription: Stripe.Subscription,
): GatewaySubscriptionSummary {
  const base = subscriptionOf(subscription);
  const item = subscription.items.data[0];
  const contact = customerContact(subscription.customer);
  return {
    id: base.id,
    status: base.status,
    customerId: base.customerId,
    customerEmail: contact.email,
    customerName: contact.name,
    priceId: base.priceId,
    unitAmountMinor: item?.price.unit_amount ?? null,
    currency: item?.price.currency ?? subscription.currency,
    interval: item?.price.recurring?.interval ?? null,
    intervalCount: item?.price.recurring?.interval_count ?? 1,
    currentPeriodEnd: base.currentPeriodEnd,
    cancelAtPeriodEnd: base.cancelAtPeriodEnd,
    createdByApplication: idOf(subscription.application),
    metadata: base.metadata,
    applicationFeePercent: base.applicationFeePercent,
  };
}

function invoiceOf(invoice: Stripe.Invoice): GatewayInvoice {
  if (!invoice.id) {
    throw new Error("invoice has no id");
  }
  const paymentIntentIds = (invoice.payments?.data ?? [])
    .map((payment) => idOf(payment.payment.payment_intent))
    .filter((id): id is string => id !== null);
  return {
    id: invoice.id,
    subscriptionId: idOf(invoice.parent?.subscription_details?.subscription),
    status: invoice.status,
    amountPaid: invoice.amount_paid,
    amountDue: invoice.amount_due,
    attemptCount: invoice.attempt_count,
    nextPaymentAttemptAt: fromUnix(invoice.next_payment_attempt),
    taxMinor: Math.max(0, invoice.total - (invoice.total_excluding_tax ?? invoice.total)),
    currency: invoice.currency,
    paymentIntentIds,
    paidAt: fromUnix(invoice.status_transitions.paid_at),
  };
}

function chargeOf(charge: Stripe.Charge): GatewayCharge {
  return {
    id: charge.id,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
    currency: charge.currency,
    paymentIntentId: idOf(charge.payment_intent),
    applicationFeeId: idOf(charge.application_fee),
  };
}

const disputeMetadataKey = "cohory_dispute_id";

function disputeOf(dispute: Stripe.Dispute): GatewayDispute {
  const chargeId = idOf(dispute.charge);
  if (!chargeId) {
    throw new Error("dispute has no charge");
  }
  return {
    id: dispute.id,
    chargeId,
    paymentIntentId: idOf(dispute.payment_intent),
    amount: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    createdAt: new Date(dispute.created * 1000),
  };
}

function applicationFeeOf(fee: Stripe.ApplicationFee): GatewayApplicationFee {
  const accountId = idOf(fee.account);
  const chargeId = idOf(fee.charge);
  if (!accountId || !chargeId) {
    throw new Error("application fee has no account or charge");
  }
  return {
    id: fee.id,
    accountId,
    chargeId,
    amount: fee.amount,
    amountRefunded: fee.amount_refunded,
    currency: fee.currency,
    createdAt: new Date(fee.created * 1000),
    refunds: fee.refunds.data.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      createdAt: new Date(refund.created * 1000),
      disputeId: refund.metadata?.[disputeMetadataKey] ?? null,
    })),
  };
}

export interface StripeGatewayOptions {
  readonly apiBaseUrl?: string | null;
}

export const stripeApiVersion = "2026-09-30.endive";

export function stripeClientConfig(options: StripeGatewayOptions = {}): Stripe.StripeConfig {
  const base: Stripe.StripeConfig = {
    apiVersion: stripeApiVersion,
    maxNetworkRetries: 2,
    timeout: 20_000,
  };
  if (!options.apiBaseUrl) {
    return base;
  }
  const url = new URL(options.apiBaseUrl);
  const protocol = url.protocol === "http:" ? "http" : "https";
  return {
    ...base,
    host: url.hostname,
    protocol,
    port: url.port === "" ? (protocol === "http" ? 80 : 443) : Number(url.port),
  };
}

export function createStripeGateway(
  secretKey: string,
  options: StripeGatewayOptions = {},
): StripeGateway {
  assertApiBaseUrlAllowed(secretKey, options.apiBaseUrl);
  const stripe = new Stripe(secretKey, stripeClientConfig(options));
  const v2Include: Stripe.V2.Core.AccountRetrieveParams.Include[] = [
    "configuration.merchant",
    "requirements",
    "identity",
  ];

  return {
    async createConnectedAccount(input, idempotencyKey) {
      const account = await stripe.v2.core.accounts.create(
        {
          display_name: input.displayName,
          ...(input.email ? { contact_email: input.email } : {}),
          dashboard: "full",
          identity: { country: input.country },
          defaults: {
            responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
          },
          configuration: {
            merchant: { capabilities: { card_payments: { requested: true } } },
          },
          include: v2Include,
          metadata: { ...input.metadata },
        },
        { idempotencyKey },
      );
      return v2AccountState(account);
    },

    async retrieveConnectedAccount(accountId) {
      return v2AccountState(
        await stripe.v2.core.accounts.retrieve(accountId, { include: v2Include }),
      );
    },

    async createOnboardingLink(input, idempotencyKey) {
      const link = await stripe.v2.core.accountLinks.create(
        {
          account: input.accountId,
          use_case: {
            type: "account_onboarding",
            account_onboarding: {
              refresh_url: input.refreshUrl,
              return_url: input.returnUrl,
            },
          },
        },
        { idempotencyKey },
      );
      return { url: link.url };
    },

    async retrieveOwnAccount() {
      return v1AccountState(await stripe.accounts.retrieveCurrent());
    },

    async createProduct(account, input, idempotencyKey) {
      const product = await stripe.products.create(
        {
          name: input.name,
          ...(input.images && input.images.length > 0 ? { images: [...input.images] } : {}),
          metadata: { ...input.metadata },
        },
        requestOptions(account, idempotencyKey),
      );
      return { id: product.id };
    },

    async createPrice(account, input, idempotencyKey) {
      const price = await stripe.prices.create(
        {
          product: input.productId,
          currency: input.currency,
          unit_amount: input.unitAmount,
          recurring: { interval: input.interval },
          metadata: { ...input.metadata },
        },
        requestOptions(account, idempotencyKey),
      );
      return { id: price.id };
    },

    async updateProduct(account, productId, input, idempotencyKey) {
      await stripe.products.update(
        productId,
        { name: input.name },
        requestOptions(account, idempotencyKey),
      );
    },

    async deactivatePrice(account, priceId, idempotencyKey) {
      await stripe.prices.update(
        priceId,
        { active: false },
        requestOptions(account, idempotencyKey),
      );
    },

    async createCheckoutSession(account, input, idempotencyKey) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: input.priceId, quantity: 1 }],
          ...(input.customerId
            ? { customer: input.customerId }
            : input.customerEmail
              ? { customer_email: input.customerEmail }
              : {}),
          client_reference_id: input.clientReferenceId,
          metadata: { ...input.metadata },
          subscription_data: {
            metadata: { ...input.metadata },
            ...(input.applicationFeePercent !== null && input.applicationFeePercent > 0
              ? { application_fee_percent: input.applicationFeePercent }
              : {}),
            ...(input.trialEnd ? { trial_end: Math.floor(input.trialEnd.getTime() / 1000) } : {}),
          },
          ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
          ...(input.submitMessage
            ? { custom_text: { submit: { message: input.submitMessage } } }
            : {}),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        requestOptions(account, idempotencyKey),
      );
      if (!session.url) {
        throw new Error("checkout session has no url");
      }
      return { id: session.id, url: session.url };
    },

    async expireOpenCheckoutSessions(account, match, idempotencyKeyPrefix) {
      const expired: string[] = [];
      const open = stripe.checkout.sessions.list(
        {
          status: "open",
          limit: 100,
          ...(match.customerId ? { customer: match.customerId } : {}),
        },
        requestOptions(account),
      );
      for await (const session of open) {
        const matches = Object.entries(match.metadata).every(
          ([key, value]) => session.metadata?.[key] === value,
        );
        if (!matches || session.id === match.keepSessionId) {
          continue;
        }
        await stripe.checkout.sessions.expire(
          session.id,
          {},
          requestOptions(account, `${idempotencyKeyPrefix}:${session.id}`),
        );
        expired.push(session.id);
      }
      return expired;
    },

    createPortalSession(account, input, idempotencyKey) {
      return createPortal(stripe, account, input, idempotencyKey);
    },

    async pauseSubscription(account, subscriptionId, input, idempotencyKey) {
      return subscriptionOf(await pause(stripe, account, subscriptionId, input, idempotencyKey));
    },

    async resumeSubscription(account, subscriptionId, idempotencyKey) {
      return subscriptionOf(await resume(stripe, account, subscriptionId, idempotencyKey));
    },

    setCancellationDetails(account, subscriptionId, details, idempotencyKey) {
      return recordCancellationDetails(stripe, account, subscriptionId, details, idempotencyKey);
    },

    async retrieveSubscription(account, subscriptionId) {
      return subscriptionOf(
        await stripe.subscriptions.retrieve(subscriptionId, {}, requestOptions(account)),
      );
    },

    async listSubscriptions(account, input) {
      const page = await stripe.subscriptions.list(
        {
          limit: input.limit,
          expand: ["data.customer"],
          ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
        },
        requestOptions(account),
      );
      const items = page.data.map(subscriptionSummaryOf);
      return { items, nextCursor: page.has_more ? (items.at(-1)?.id ?? null) : null };
    },

    async retrieveSubscriptionSummary(account, subscriptionId) {
      return subscriptionSummaryOf(
        await stripe.subscriptions.retrieve(
          subscriptionId,
          { expand: ["customer"] },
          requestOptions(account),
        ),
      );
    },

    async setSubscriptionApplicationFee(account, subscriptionId, percent, idempotencyKey) {
      return subscriptionOf(
        await stripe.subscriptions.update(
          subscriptionId,
          { application_fee_percent: percent },
          requestOptions(account, idempotencyKey),
        ),
      );
    },

    async retrieveEvent(account, eventId) {
      return parseVerifiedEvent(await stripe.events.retrieve(eventId, {}, requestOptions(account)));
    },

    async retrieveInvoice(account, invoiceId) {
      return invoiceOf(
        await stripe.invoices.retrieve(
          invoiceId,
          { expand: ["payments"] },
          requestOptions(account),
        ),
      );
    },

    async listPaidInvoices(account, subscriptionId) {
      const page = await stripe.invoices.list(
        { subscription: subscriptionId, status: "paid", limit: 100, expand: ["data.payments"] },
        requestOptions(account),
      );
      return page.data.map(invoiceOf);
    },

    async retrieveCharge(account, chargeId) {
      return chargeOf(await stripe.charges.retrieve(chargeId, {}, requestOptions(account)));
    },

    async listCharges(account, input) {
      const page = await stripe.charges.list(
        {
          limit: input.limit,
          created: { gte: Math.floor(input.createdSince.getTime() / 1000) },
          ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
        },
        requestOptions(account),
      );
      const items = page.data.map(chargeOf);
      return { items, nextCursor: page.has_more ? (items.at(-1)?.id ?? null) : null };
    },

    async retrieveApplicationFee(feeId) {
      return applicationFeeOf(await stripe.applicationFees.retrieve(feeId));
    },

    async retrieveDispute(account, disputeId) {
      return disputeOf(await stripe.disputes.retrieve(disputeId, {}, requestOptions(account)));
    },

    async refundApplicationFee(feeId, amountMinor, idempotencyKey, disputeId) {
      await stripe.applicationFees.createRefund(
        feeId,
        {
          amount: amountMinor,
          ...(disputeId ? { metadata: { [disputeMetadataKey]: disputeId } } : {}),
        },
        { idempotencyKey },
      );
    },

    async clearSubscriptionApplicationFee(account, subscriptionId, idempotencyKey) {
      return subscriptionOf(
        await stripe.subscriptions.update(
          subscriptionId,
          { application_fee_percent: "" },
          requestOptions(account, idempotencyKey),
        ),
      );
    },

    async cancelSubscription(account, subscriptionId, idempotencyKey, comment) {
      return subscriptionOf(
        await stripe.subscriptions.cancel(
          subscriptionId,
          {
            prorate: false,
            invoice_now: false,
            ...(comment ? { cancellation_details: { comment } } : {}),
          },
          requestOptions(account, idempotencyKey),
        ),
      );
    },

    async scheduleCancellation(account, subscriptionId, idempotencyKey) {
      return subscriptionOf(
        await stripe.subscriptions.update(
          subscriptionId,
          { cancel_at_period_end: true },
          requestOptions(account, idempotencyKey),
        ),
      );
    },

    async createRefund(account, input, idempotencyKey) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          ...(input.amountMinor === null ? {} : { amount: input.amountMinor }),
        },
        requestOptions(account, idempotencyKey),
      );
      return {
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status ?? "pending",
      };
    },

    async deleteCustomer(account, customerId, idempotencyKey) {
      await stripe.customers.del(customerId, {}, requestOptions(account, idempotencyKey));
    },
  };
}

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  account: z.string().nullish(),
  livemode: z.boolean(),
  data: z.object({ object: z.looseObject({ id: z.string().min(1) }) }),
});

export function parseVerifiedEvent(payload: unknown): VerifiedEvent {
  const event = eventSchema.parse(payload);
  return {
    id: event.id,
    type: event.type,
    account: event.account ?? null,
    livemode: event.livemode,
    object: event.data.object,
  };
}

export const verifyStripeWebhook: WebhookVerifier = (rawBody, signature, secrets) => {
  for (const secret of secrets) {
    try {
      const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      return parseVerifiedEvent(event);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw error;
      }
    }
  }
  throw new WebhookSignatureError();
};
