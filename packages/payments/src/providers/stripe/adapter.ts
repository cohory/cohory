import type { PaymentDisputeStatus } from "@cohory/db/schema";
import { z } from "zod";

import { isLiveKey } from "../../config";
import { PaymentsUnavailableError } from "../../errors";
import { applicationFeePercent } from "../../fee";
import type {
  GatewayApplicationFee,
  GatewayCharge,
  StripeAccount,
  StripeGateway,
  VerifiedEvent,
  WebhookVerifier,
} from "../../gateway";
import { WebhookSignatureError } from "../../stripe-gateway";
import { stripeConnectCapabilities, stripeOwnKeysCapabilities } from "../capabilities";
import type { Connection, NormalizedEvent, PaymentProvider } from "../types";

export type StripeProviderKind = "stripe_connect" | "stripe_own_keys";

export interface StripeProviderDeps {
  readonly platformGateway: StripeGateway | null;
  readonly gatewayForSecret: ((secretKey: string) => StripeGateway) | null;
  readonly verifyWebhook: WebhookVerifier | null;
  readonly webhookSecrets: readonly string[];
  readonly platformSecretKey: string | null;
  readonly connectClientId: string | null;
}

export interface BoundStripe {
  readonly gateway: StripeGateway;
  readonly account: StripeAccount;
}

const uuid = z.uuid();
const metadataSchema = z.record(z.string(), z.string()).default({});
const reference = z.union([z.string(), z.looseObject({ id: z.string() })]).nullish();
const checkoutSessionSchema = z.looseObject({
  id: z.string(),
  mode: z.string().nullish(),
  subscription: reference,
  customer: reference,
  metadata: metadataSchema.nullish(),
});

const fraudWarningSchema = z.looseObject({ charge: reference });

const wonDisputeStatuses: ReadonlySet<string> = new Set(["won", "warning_closed", "prevented"]);

function disputeStatusOf(status: string): PaymentDisputeStatus {
  if (status === "lost") {
    return "lost";
  }
  return wonDisputeStatuses.has(status) ? "won" : "open";
}

function refId(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.id;
}

const platformFeeEventTypes: ReadonlySet<string> = new Set([
  "application_fee.created",
  "application_fee.refunded",
]);

// After a creator leaves, Stripe still reports fees on charges made before the exit and the
// final deauthorization, and both must reach the exit handlers.
const afterDisconnectEventTypes: ReadonlySet<string> = new Set([
  ...platformFeeEventTypes,
  "account.application.deauthorized",
]);

function accountOf(event: VerifiedEvent): string | null {
  if (event.account) {
    return event.account;
  }
  const account = event.object["account"];
  return typeof account === "string" ? account : null;
}

export const checkoutSessionPlaceholder = "session_id={CHECKOUT_SESSION_ID}";

export function createStripeProvider(
  kind: StripeProviderKind,
  deps: StripeProviderDeps,
): PaymentProvider {
  const connect = kind === "stripe_connect";
  const record = connect ? stripeConnectCapabilities : stripeOwnKeysCapabilities;

  function bind(conn: Connection): BoundStripe {
    if (connect) {
      if (!conn.externalAccountId) {
        throw new PaymentsUnavailableError("connected account");
      }
      if (!deps.platformGateway) {
        throw new PaymentsUnavailableError("STRIPE_SECRET_KEY");
      }
      return { gateway: deps.platformGateway, account: conn.externalAccountId };
    }
    if (!deps.gatewayForSecret || !conn.apiCredential) {
      throw new PaymentsUnavailableError("own Stripe keys");
    }
    return { gateway: deps.gatewayForSecret(conn.apiCredential), account: null };
  }

  function refundOf(charge: GatewayCharge): NormalizedEvent {
    return {
      kind: "payment_refunded",
      refund: {
        chargeRef: charge.id,
        paymentRef: charge.paymentIntentId,
        chargedMinor: charge.amount,
        refundedMinor: charge.amountRefunded,
        paymentRefundedMinor: charge.amountRefunded,
        platformFeeId: connect ? charge.applicationFeeId : null,
      },
    };
  }

  function feeReportOf(fee: GatewayApplicationFee, charge: GatewayCharge): NormalizedEvent {
    return {
      kind: "platform_fee_reported",
      fee,
      chargedMinor: charge.amount,
      paymentRef: charge.paymentIntentId,
    };
  }

  async function normalize(
    type: string,
    object: Readonly<Record<string, unknown>> & { readonly id: string },
    conn: Connection,
  ): Promise<NormalizedEvent[] | null> {
    switch (type) {
      case "checkout.session.completed": {
        const session = checkoutSessionSchema.parse(object);
        const subscriptionId = refId(session.subscription);
        if (session.mode !== "subscription" || !subscriptionId) {
          return [];
        }
        const metadata = session.metadata ?? {};
        const userId = metadata["cohory_user_id"];
        const ours =
          metadata["cohory_community_id"] === conn.communityId && uuid.safeParse(userId).success;
        return [
          {
            kind: "checkout_completed",
            subscriptionId,
            userIdHint: ours && userId ? userId : null,
          },
        ];
      }
      case "checkout.session.expired": {
        const session = checkoutSessionSchema.parse(object);
        const userId = session.metadata?.["cohory_user_id"];
        const ours =
          session.metadata?.["cohory_community_id"] === conn.communityId &&
          uuid.safeParse(userId).success;
        return [{ kind: "checkout_expired", userIdHint: ours && userId ? userId : null }];
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return [{ kind: "subscription_changed", subscriptionId: object.id }];
      case "invoice.paid":
      case "invoice.payment_failed": {
        const { gateway, account } = bind(conn);
        const invoice = await gateway.retrieveInvoice(account, object.id);
        const events: NormalizedEvent[] = invoice.subscriptionId
          ? [{ kind: "subscription_changed", subscriptionId: invoice.subscriptionId }]
          : [];
        if (
          type === "invoice.payment_failed" &&
          invoice.subscriptionId &&
          invoice.status === "open" &&
          invoice.amountDue > 0
        ) {
          events.push({
            kind: "payment_failed",
            failure: {
              invoiceRef: invoice.id,
              subscriptionRef: invoice.subscriptionId,
              amountMinor: invoice.amountDue,
              currency: invoice.currency,
              attempt: invoice.attemptCount,
              nextAttemptAt: invoice.nextPaymentAttemptAt,
            },
          });
        }
        if (type === "invoice.paid" && invoice.amountPaid > 0) {
          events.push({
            kind: "payment_succeeded",
            payment: {
              externalId: invoice.id,
              subscriptionId: invoice.subscriptionId,
              paymentRef: invoice.paymentIntentIds[0] ?? null,
              currency: invoice.currency,
              amountMinor: invoice.amountPaid,
              taxMinor: Math.min(invoice.taxMinor, invoice.amountPaid),
              paidAt: invoice.paidAt,
            },
          });
        }
        return events;
      }
      case "application_fee.created":
      case "application_fee.refunded": {
        if (!connect) {
          return [];
        }
        const { gateway, account } = bind(conn);
        const fee = await gateway.retrieveApplicationFee(object.id);
        if (fee.accountId !== conn.externalAccountId) {
          return [];
        }
        return [feeReportOf(fee, await gateway.retrieveCharge(account, fee.chargeId))];
      }
      case "charge.refunded": {
        const { gateway, account } = bind(conn);
        return [refundOf(await gateway.retrieveCharge(account, object.id))];
      }
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated": {
        const { gateway, account } = bind(conn);
        const dispute = await gateway.retrieveDispute(account, object.id);
        const charge = await gateway.retrieveCharge(account, dispute.chargeId);
        const sameCurrency = dispute.currency === charge.currency;
        return [
          {
            kind: "dispute_changed",
            dispute: {
              id: dispute.id,
              status: disputeStatusOf(dispute.status),
              chargeRef: charge.id,
              paymentRef: dispute.paymentIntentId ?? charge.paymentIntentId,
              currency: charge.currency,
              disputedMinor: sameCurrency ? Math.min(dispute.amount, charge.amount) : charge.amount,
              chargedMinor: charge.amount,
              refundedMinor: charge.amountRefunded,
              platformFeeId: connect ? charge.applicationFeeId : null,
              openedAt: dispute.createdAt,
            },
          },
        ];
      }
      case "radar.early_fraud_warning.created":
        return [
          { kind: "fraud_warning", chargeRef: refId(fraudWarningSchema.parse(object).charge) },
        ];
      case "account.updated":
        return connect ? [{ kind: "account_updated" }] : [];
      case "account.application.deauthorized":
        return connect ? [{ kind: "account_deauthorized" }] : [];
      default:
        return null;
    }
  }

  const provider: PaymentProvider = {
    id: kind,
    displayName: record.displayName,
    setup: record.setup,

    capabilities() {
      return record.capabilities;
    },

    expectsLiveEvents(conn) {
      return isLiveKey((connect ? deps.platformSecretKey : conn?.apiCredential) ?? "");
    },

    verifyWebhook(request, conn) {
      const signature = request.header("stripe-signature");
      const secrets = conn
        ? [conn.webhookSecret].filter((secret): secret is string => secret !== null)
        : deps.webhookSecrets;
      if (!deps.verifyWebhook || !signature || secrets.length === 0) {
        throw new WebhookSignatureError();
      }
      return deps.verifyWebhook(request.rawBody, signature, secrets);
    },

    normalizeEvent(event, conn) {
      return normalize(event.type, event.object, conn);
    },

    async retrieveEvent(ref, conn) {
      const { gateway, account } = bind(conn);
      return await gateway.retrieveEvent(connect ? ref.accountId : account, ref.eventId);
    },

    async getAccountState(conn) {
      const { gateway, account } = bind(conn);
      return account
        ? await gateway.retrieveConnectedAccount(account)
        : await gateway.retrieveOwnAccount();
    },

    async provisionPlan(plan, conn) {
      const { gateway, account } = bind(conn);
      const metadata = { cohory_community_id: plan.communityId, cohory_plan_id: plan.planId };
      const productId =
        plan.productId ??
        (
          await gateway.createProduct(
            account,
            { name: plan.name, images: plan.imageUrl ? [plan.imageUrl] : [], metadata },
            `plan:${plan.planId}:product`,
          )
        ).id;
      const price = async (interval: "month" | "year", unitAmount: number) =>
        (
          await gateway.createPrice(
            account,
            { productId, currency: plan.currency, unitAmount, interval, metadata },
            `plan:${plan.planId}:price:${interval}`,
          )
        ).id;
      const monthlyPriceId = plan.monthlyPriceId ?? (await price("month", plan.monthlyPriceMinor));
      const annualPriceId =
        plan.annualPriceMinor === null
          ? null
          : (plan.annualPriceId ?? (await price("year", plan.annualPriceMinor)));
      return { productId, monthlyPriceId, annualPriceId };
    },

    async retirePrice(priceId, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      await gateway.deactivatePrice(account, priceId, idempotencyKey);
    },

    async renameProduct(productId, name, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      await gateway.updateProduct(account, productId, { name }, idempotencyKey);
    },

    async createCheckout(input, conn) {
      const { gateway, account } = bind(conn);
      const session = await gateway.createCheckoutSession(
        account,
        {
          priceId: input.priceId,
          customerId: input.customerId,
          customerEmail: input.customerEmail,
          clientReferenceId: input.clientReferenceId,
          metadata: input.metadata,
          applicationFeePercent:
            connect && input.platformFeeBps > 0
              ? applicationFeePercent(input.platformFeeBps)
              : null,
          trialEnd: input.trialEnd,
          expiresAt: input.expiresAt,
          submitMessage: input.submitMessage,
          successUrl: `${input.successUrl}&${checkoutSessionPlaceholder}`,
          cancelUrl: input.cancelUrl,
        },
        input.idempotencyKey,
      );
      return { url: session.url, externalId: session.id };
    },

    async expireOtherCheckouts(match, idempotencyKeyPrefix, conn) {
      const { gateway, account } = bind(conn);
      await gateway.expireOpenCheckoutSessions(
        account,
        {
          metadata: match.metadata,
          customerId: match.customerId,
          keepSessionId: match.keepExternalId,
        },
        idempotencyKeyPrefix,
      );
    },

    async paidPaymentRefs(subscriptionId, conn) {
      const { gateway, account } = bind(conn);
      const invoices = await gateway.listPaidInvoices(account, subscriptionId);
      return invoices.flatMap((invoice) => invoice.paymentIntentIds);
    },

    async createPortalSession(customerId, returnUrl, idempotencyKey, conn, flow) {
      const { gateway, account } = bind(conn);
      return await gateway.createPortalSession(
        account,
        { customerId, returnUrl, ...(flow ? { flow } : {}) },
        idempotencyKey,
      );
    },

    async pauseSubscription(id, input, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      return await gateway.pauseSubscription(account, id, input, idempotencyKey);
    },

    async resumeSubscription(id, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      return await gateway.resumeSubscription(account, id, idempotencyKey);
    },

    async recordCancellationDetails(id, details, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      await gateway.setCancellationDetails(account, id, details, idempotencyKey);
    },

    async getSubscription(id, conn) {
      const { gateway, account } = bind(conn);
      return await gateway.retrieveSubscription(account, id);
    },

    async cancelSubscription(id, opts, conn) {
      const { gateway, account } = bind(conn);
      return opts.atPeriodEnd
        ? await gateway.scheduleCancellation(account, id, opts.idempotencyKey)
        : await gateway.cancelSubscription(account, id, opts.idempotencyKey, opts.comment);
    },

    async refund(paymentRef, amount, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      const refund = await gateway.createRefund(
        account,
        { paymentIntentId: paymentRef, amountMinor: amount === "full" ? null : amount },
        idempotencyKey,
      );
      return {
        id: refund.id,
        amountMinor: refund.amount,
        currency: refund.currency,
        status: refund.status,
      };
    },

    async deleteCustomer(customerId, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      await gateway.deleteCustomer(account, customerId, idempotencyKey);
    },

    async listSubscriptions(conn, page) {
      const { gateway, account } = bind(conn);
      return await gateway.listSubscriptions(account, page);
    },

    async listFeeActivity(conn, since) {
      const { gateway, account } = bind(conn);
      const events: NormalizedEvent[] = [];
      let cursor: string | null = null;
      do {
        const page = await gateway.listCharges(account, {
          createdSince: since,
          startingAfter: cursor,
          limit: 100,
        });
        for (const charge of page.items) {
          const fee =
            connect && charge.applicationFeeId
              ? await gateway.retrieveApplicationFee(charge.applicationFeeId)
              : null;
          if (fee && fee.accountId === conn.externalAccountId) {
            events.push(feeReportOf(fee, charge));
          }
          if (charge.amountRefunded > 0) {
            events.push(refundOf(charge));
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
      return events;
    },

    async getSubscriptionSummary(id, conn) {
      const { gateway, account } = bind(conn);
      return await gateway.retrieveSubscriptionSummary(account, id);
    },

    async setPlatformFee(subscriptionId, rateBps, idempotencyKey, conn) {
      const { gateway, account } = bind(conn);
      return rateBps === 0
        ? await gateway.clearSubscriptionApplicationFee(account, subscriptionId, idempotencyKey)
        : await gateway.setSubscriptionApplicationFee(
            account,
            subscriptionId,
            applicationFeePercent(rateBps),
            idempotencyKey,
          );
    },
  };

  if (!connect) {
    return provider;
  }
  function requirePlatformGateway(): StripeGateway {
    if (!deps.platformGateway) {
      throw new PaymentsUnavailableError("STRIPE_SECRET_KEY");
    }
    return deps.platformGateway;
  }
  return {
    ...provider,
    applicationId: deps.connectClientId,
    platformWebhooks: {
      isConfigured() {
        return (
          deps.webhookSecrets.length > 0 && deps.verifyWebhook !== null && !!deps.platformSecretKey
        );
      },
      accountOf,
      acceptsAfterDisconnect(type) {
        return afterDisconnectEventTypes.has(type);
      },
    },
    hostedOnboarding() {
      const gateway = requirePlatformGateway();
      return {
        async platformCountry() {
          const account = await gateway.retrieveOwnAccount();
          return account.country?.toLowerCase() ?? null;
        },
        createAccount(input, idempotencyKey) {
          return gateway.createConnectedAccount(input, idempotencyKey);
        },
        createLink(input, idempotencyKey) {
          return gateway.createOnboardingLink(input, idempotencyKey);
        },
      };
    },
    platformFees: {
      isFeeEvent(type) {
        return platformFeeEventTypes.has(type);
      },
      get(feeId) {
        return requirePlatformGateway().retrieveApplicationFee(feeId);
      },
      async refund(feeId, amountMinor, idempotencyKey, _conn, disputeId) {
        await requirePlatformGateway().refundApplicationFee(
          feeId,
          amountMinor,
          idempotencyKey,
          disputeId,
        );
      },
    },
  };
}
