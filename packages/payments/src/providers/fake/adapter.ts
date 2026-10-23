import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { AccountState } from "../../gateway";
import { WebhookSignatureError } from "../../stripe-gateway";
import type {
  CheckoutRequest,
  Connection,
  NormalizedEvent,
  PaymentProvider,
  ProviderCapabilities,
  ProviderId,
  ProviderSubscription,
} from "../types";

export const fakeSignatureHeader = "fake-signature";

export interface FakeProviderCall {
  readonly method: string;
  readonly connectionId: string;
  readonly idempotencyKey: string | null;
  readonly input: unknown;
}

export interface FakeProvider extends PaymentProvider {
  readonly calls: FakeProviderCall[];
  readonly subscriptions: Map<string, ProviderSubscription>;
  readonly account: { state: AccountState };
  lastCheckout(): CheckoutRequest | null;
}

export interface FakeProviderOptions {
  readonly id?: ProviderId;
  readonly displayName?: string;
  readonly capabilities?: Partial<ProviderCapabilities>;
}

const fakeCapabilities: ProviderCapabilities = {
  supportsFeeSplit: false,
  supportsSubscriptions: true,
  supportsSubscriptionImport: false,
  supportsHostedCheckout: true,
  supportsCustomerPortal: true,
  supportsRefundApi: true,
  emitsDisputeEvents: false,
  currencies: "any",
};

const isoDate = z.iso.datetime().transform((value) => new Date(value));

const paymentSchema = z.object({
  externalId: z.string(),
  subscriptionId: z.string().nullable(),
  paymentRef: z.string().nullable(),
  currency: z.string(),
  amountMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  paidAt: isoDate.nullable(),
});

const refundSchema = z.object({
  chargeRef: z.string(),
  paymentRef: z.string().nullable(),
  chargedMinor: z.number().int().nonnegative(),
  refundedMinor: z.number().int().nonnegative(),
  paymentRefundedMinor: z.number().int().nonnegative(),
});

const envelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  livemode: z.boolean().default(false),
  data: z.looseObject({ id: z.string().min(1) }),
});

function signature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signFakeEvent(
  secret: string,
  event: { id: string; type: string; livemode?: boolean; data: Record<string, unknown> },
): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify({ livemode: false, ...event });
  return { rawBody, headers: { [fakeSignatureHeader]: signature(secret, rawBody) } };
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const calls: FakeProviderCall[] = [];
  const subscriptions = new Map<string, ProviderSubscription>();
  const account = {
    state: {
      id: `org_fake_${randomUUID()}`,
      chargesEnabled: true,
      detailsSubmitted: true,
      livemode: false,
      country: null,
    } satisfies AccountState,
  };
  let counter = 0;
  const capabilities = { ...fakeCapabilities, ...options.capabilities };

  function record(method: string, conn: Connection, key: string | null, input: unknown) {
    calls.push({ method, connectionId: conn.id, idempotencyKey: key, input });
  }

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}_fake${counter}`;
  }

  function need(id: string): ProviderSubscription {
    const subscription = subscriptions.get(id);
    if (!subscription) {
      throw new Error(`fake provider has no subscription ${id}`);
    }
    return subscription;
  }

  return {
    id: options.id ?? "polar",
    displayName: options.displayName ?? "Fake provider",
    setup: "access_token",
    calls,
    subscriptions,
    account,

    lastCheckout() {
      const call = calls.filter((entry) => entry.method === "createCheckout").at(-1);
      return call ? (call.input as CheckoutRequest) : null;
    },

    capabilities() {
      return capabilities;
    },

    expectsLiveEvents(conn) {
      return conn?.livemode ?? false;
    },

    verifyWebhook(request, conn) {
      const given = request.header(fakeSignatureHeader);
      const secret = conn?.webhookSecret;
      if (!given || !secret) {
        throw new WebhookSignatureError();
      }
      const expected = Buffer.from(signature(secret, request.rawBody));
      const actual = Buffer.from(given);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new WebhookSignatureError();
      }
      const envelope = envelopeSchema.parse(JSON.parse(request.rawBody));
      return {
        id: envelope.id,
        type: envelope.type,
        account: null,
        livemode: envelope.livemode,
        object: envelope.data,
      };
    },

    async normalizeEvent(event): Promise<NormalizedEvent[] | null> {
      switch (event.type) {
        case "subscription.updated":
          return [{ kind: "subscription_changed", subscriptionId: event.object.id }];
        case "payment.succeeded": {
          const payment = paymentSchema.parse(event.object["payment"]);
          return [
            ...(payment.subscriptionId
              ? [{ kind: "subscription_changed" as const, subscriptionId: payment.subscriptionId }]
              : []),
            { kind: "payment_succeeded", payment },
          ];
        }
        case "payment.refunded":
          return [
            {
              kind: "payment_refunded",
              refund: { ...refundSchema.parse(event.object["refund"]), platformFeeId: null },
            },
          ];
        case "account.updated":
          return [{ kind: "account_updated" }];
        case "ping":
          return [];
        default:
          return null;
      }
    },

    async getAccountState(conn) {
      record("getAccountState", conn, null, null);
      return account.state;
    },

    async provisionPlan(plan, conn) {
      record("provisionPlan", conn, `plan:${plan.planId}`, plan);
      return {
        productId: plan.productId ?? `prod_${plan.planId}`,
        monthlyPriceId: plan.monthlyPriceId ?? `price_${plan.planId}_month`,
        annualPriceId:
          plan.annualPriceMinor === null
            ? null
            : (plan.annualPriceId ?? `price_${plan.planId}_year`),
      };
    },

    async retirePrice(priceId, idempotencyKey, conn) {
      record("retirePrice", conn, idempotencyKey, { priceId });
    },

    async createCheckout(input, conn) {
      record("createCheckout", conn, input.idempotencyKey, input);
      const externalId = nextId("checkout");
      return { url: `https://checkout.fake.test/${externalId}`, externalId };
    },

    async createPortalSession(customerId, returnUrl, idempotencyKey, conn) {
      record("createPortalSession", conn, idempotencyKey, { customerId, returnUrl });
      return { url: `https://portal.fake.test/${customerId}` };
    },

    async getSubscription(id, conn) {
      record("getSubscription", conn, null, { id });
      return need(id);
    },

    async cancelSubscription(id, opts, conn) {
      record("cancelSubscription", conn, opts.idempotencyKey, { id, ...opts });
      const current = need(id);
      const next = opts.atPeriodEnd
        ? { ...current, cancelAtPeriodEnd: true }
        : { ...current, status: "canceled", endedAt: new Date() };
      subscriptions.set(id, next);
      return next;
    },

    signTestEvent(conn, eventId) {
      return signFakeEvent(conn.webhookSecret ?? "", {
        id: eventId,
        type: "ping",
        data: { id: eventId },
      });
    },

    async refund(paymentRef, amount, idempotencyKey, conn) {
      record("refund", conn, idempotencyKey, { paymentRef, amount });
      return {
        id: nextId("refund"),
        amountMinor: amount === "full" ? 0 : amount,
        currency: "usd",
        status: "succeeded",
      };
    },
  };
}
