import { z } from "zod";

import { PaymentsUnavailableError, ProviderRejectedError } from "../../errors";
import type { AccountState, GatewaySubscription } from "../../gateway";
import { WebhookSignatureError } from "../../stripe-gateway";
import { polarCapabilities } from "../capabilities";
import type { Connection, NormalizedEvent, PaymentProvider } from "../types";
import { createPolarClient, polarProductionUrl, polarSandboxUrl, type PolarClient } from "./client";
import {
  polarCheckoutEventSchema,
  polarCheckoutSchema,
  polarCustomerSessionSchema,
  polarEnvelopeSchema,
  polarOrderSchema,
  polarOrganizationListSchema,
  polarProductListSchema,
  polarProductSchema,
  polarRefundSchema,
  polarSubscriptionSchema,
  type PolarOrder,
  type PolarSubscription,
} from "./schemas";
import { signStandardWebhook, verifyStandardWebhook } from "./webhook";

export interface PolarProviderDeps {
  readonly apiBaseUrl: string | null;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

export const polarCheckoutPlaceholder = "checkout_id={CHECKOUT_ID}";
export const polarTestEventType = "cohory.test";

const subscriptionEvents = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
  "subscription.cycled",
  "subscription.paused",
  "subscription.resumed",
]);

const uuid = z.uuid();

function intervalOf(subscription: PolarSubscription): GatewaySubscription["interval"] {
  if (
    subscription.recurring_interval_count !== 1 &&
    subscription.recurring_interval_count != null
  ) {
    return null;
  }
  return subscription.recurring_interval === "month" || subscription.recurring_interval === "year"
    ? subscription.recurring_interval
    : null;
}

export function toProviderSubscription(subscription: PolarSubscription): GatewaySubscription {
  return {
    id: subscription.id,
    status: subscription.status,
    customerId: subscription.customer_id,
    metadata: subscription.metadata,
    currentPeriodEnd: subscription.ends_at ?? subscription.current_period_end ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    endedAt: subscription.ended_at ?? null,
    interval: intervalOf(subscription),
    applicationFeePercent: null,
    priceId: subscription.product_id ?? null,
  };
}

function productName(name: string, interval: "month" | "year"): string {
  const label = `${name} (${interval === "month" ? "monthly" : "yearly"})`;
  return label.slice(0, 64);
}

export function createPolarProvider(deps: PolarProviderDeps): PaymentProvider {
  function client(conn: Connection): PolarClient {
    if (!conn.apiCredential) {
      throw new PaymentsUnavailableError("Polar access token");
    }
    return createPolarClient({
      baseUrl: deps.apiBaseUrl ?? (conn.livemode ? polarProductionUrl : polarSandboxUrl),
      token: conn.apiCredential,
      fetch: deps.fetch,
    });
  }

  function getOrder(conn: Connection, id: string): Promise<PolarOrder> {
    return client(conn).get(polarOrderSchema, `/v1/orders/${encodeURIComponent(id)}`);
  }

  async function ensureProduct(
    conn: Connection,
    plan: { planId: string; communityId: string; name: string; currency: string },
    interval: "month" | "year",
    amount: number,
  ): Promise<string> {
    const api = client(conn);
    const existing = await api.get(polarProductListSchema, "/v1/products/", {
      "metadata[cohory_plan_id]": plan.planId,
      "metadata[cohory_interval]": interval,
      is_archived: false,
      limit: 1,
    });
    const found = existing.items[0];
    if (found) {
      return found.id;
    }
    const created = await api.send(polarProductSchema, "POST", "/v1/products/", {
      name: productName(plan.name, interval),
      recurring_interval: interval,
      prices: [{ amount_type: "fixed", price_amount: amount, price_currency: plan.currency }],
      metadata: {
        cohory_community_id: plan.communityId,
        cohory_plan_id: plan.planId,
        cohory_interval: interval,
      },
    });
    return created.id;
  }

  async function normalize(
    type: string,
    data: Readonly<Record<string, unknown>> & { readonly id: string },
    conn: Connection,
  ): Promise<NormalizedEvent[] | null> {
    if (subscriptionEvents.has(type)) {
      return [{ kind: "subscription_changed", subscriptionId: data.id }];
    }
    switch (type) {
      case "checkout.updated": {
        const checkout = polarCheckoutEventSchema.parse(data);
        if (checkout.status !== "succeeded" || !checkout.subscription_id) {
          return [];
        }
        const userId = checkout.metadata["cohory_user_id"];
        const ours =
          checkout.metadata["cohory_community_id"] === conn.communityId &&
          uuid.safeParse(userId).success;
        return [
          {
            kind: "checkout_completed",
            subscriptionId: checkout.subscription_id,
            userIdHint: ours && userId ? userId : null,
          },
        ];
      }
      case "order.paid": {
        const order = await getOrder(conn, data.id);
        if (!order.paid) {
          return [];
        }
        const events: NormalizedEvent[] = order.subscription_id
          ? [{ kind: "subscription_changed", subscriptionId: order.subscription_id }]
          : [];
        if (order.total_amount > 0) {
          events.push({
            kind: "payment_succeeded",
            payment: {
              externalId: order.id,
              subscriptionId: order.subscription_id ?? null,
              paymentRef: order.id,
              currency: order.currency.toLowerCase(),
              amountMinor: order.total_amount,
              taxMinor: order.tax_amount,
              paidAt: order.created_at,
            },
          });
        }
        return events;
      }
      case "order.refunded": {
        const order = await getOrder(conn, data.id);
        return [
          {
            kind: "payment_refunded",
            refund: {
              chargeRef: order.id,
              paymentRef: order.id,
              chargedMinor: order.net_amount,
              refundedMinor: Math.min(order.refunded_amount, order.net_amount),
              paymentRefundedMinor: order.refunded_amount + order.refunded_tax_amount,
              platformFeeId: null,
            },
          },
        ];
      }
      case "organization.updated":
        return [{ kind: "account_updated" }];
      case polarTestEventType:
        return [];
      default:
        return null;
    }
  }

  return {
    id: "polar",
    displayName: polarCapabilities.displayName,
    setup: polarCapabilities.setup,

    capabilities() {
      return polarCapabilities.capabilities;
    },

    expectsLiveEvents(conn) {
      return conn?.livemode ?? false;
    },

    verifyWebhook(request, conn) {
      if (!conn?.webhookSecret) {
        throw new WebhookSignatureError();
      }
      const id = verifyStandardWebhook(
        request.rawBody,
        {
          id: request.header("webhook-id"),
          timestamp: request.header("webhook-timestamp"),
          signature: request.header("webhook-signature"),
        },
        conn.webhookSecret,
        deps.now(),
      );
      const envelope = polarEnvelopeSchema.parse(JSON.parse(request.rawBody));
      return {
        id,
        type: envelope.type,
        account: null,
        livemode: conn.livemode,
        object: envelope.data,
      };
    },

    normalizeEvent(event, conn) {
      return normalize(event.type, event.object, conn);
    },

    async getAccountState(conn): Promise<AccountState> {
      const list = await client(conn).get(polarOrganizationListSchema, "/v1/organizations/", {
        limit: 1,
      });
      const organization = list.items[0];
      if (!organization) {
        throw new ProviderRejectedError("Polar", 404, "organization_missing");
      }
      return {
        id: organization.id,
        chargesEnabled:
          organization.capabilities?.checkout_payments ?? organization.status === "active",
        detailsSubmitted: organization.details_submitted_at != null,
        livemode: conn.livemode,
        country: null,
      };
    },

    async provisionPlan(plan, conn) {
      const monthlyPriceId =
        plan.monthlyPriceId ?? (await ensureProduct(conn, plan, "month", plan.monthlyPriceMinor));
      const annualPriceId =
        plan.annualPriceMinor === null
          ? null
          : (plan.annualPriceId ??
            (await ensureProduct(conn, plan, "year", plan.annualPriceMinor)));
      return { productId: plan.productId ?? monthlyPriceId, monthlyPriceId, annualPriceId };
    },

    async retirePrice(priceId, _idempotencyKey, conn) {
      await client(conn).send(
        polarProductSchema,
        "PATCH",
        `/v1/products/${encodeURIComponent(priceId)}`,
        { is_archived: true },
      );
    },

    async createCheckout(input, conn) {
      const checkout = await client(conn).send(polarCheckoutSchema, "POST", "/v1/checkouts/", {
        products: [input.priceId],
        success_url: `${input.successUrl}&${polarCheckoutPlaceholder}`,
        return_url: input.cancelUrl,
        metadata: input.metadata,
        allow_trial: false,
        ...(input.customerId
          ? { customer_id: input.customerId }
          : {
              external_customer_id: input.clientReferenceId,
              ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
            }),
      });
      return { url: checkout.url, externalId: checkout.id };
    },

    async createPortalSession(customerId, returnUrl, _idempotencyKey, conn) {
      const session = await client(conn).send(
        polarCustomerSessionSchema,
        "POST",
        "/v1/customer-sessions/",
        { customer_id: customerId, return_url: returnUrl },
      );
      return { url: session.customer_portal_url };
    },

    async getSubscription(id, conn) {
      return toProviderSubscription(
        await client(conn).get(
          polarSubscriptionSchema,
          `/v1/subscriptions/${encodeURIComponent(id)}`,
        ),
      );
    },

    async cancelSubscription(id, opts, conn) {
      return toProviderSubscription(
        await client(conn).send(
          polarSubscriptionSchema,
          "PATCH",
          `/v1/subscriptions/${encodeURIComponent(id)}`,
          opts.atPeriodEnd ? { cancel_at_period_end: true } : { revoke: true },
        ),
      );
    },

    async refund(paymentRef, amount, idempotencyKey, conn) {
      const order = await getOrder(conn, paymentRef);
      const refundable = order.refundable_amount ?? order.net_amount - order.refunded_amount;
      const refund = await client(conn).send(polarRefundSchema, "POST", "/v1/refunds/", {
        order_id: paymentRef,
        reason: "customer_request",
        amount: amount === "full" ? refundable : amount,
        metadata: { cohory_idempotency_key: idempotencyKey.slice(0, 500) },
      });
      return {
        id: refund.id,
        amountMinor: refund.amount,
        currency: refund.currency.toLowerCase(),
        status: refund.status,
      };
    },

    async deleteCustomer(customerId, _idempotencyKey, conn) {
      await client(conn).remove(`/v1/customers/${encodeURIComponent(customerId)}`);
    },

    signTestEvent(conn, eventId, at) {
      const rawBody = JSON.stringify({
        type: polarTestEventType,
        timestamp: at.toISOString(),
        data: { id: eventId },
      });
      return {
        rawBody,
        headers: signStandardWebhook(conn.webhookSecret ?? "", eventId, at, rawBody),
      };
    },
  };
}
