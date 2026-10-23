import { expect } from "@playwright/test";
import Stripe from "stripe";

export const fakeStripeUrl = process.env.E2E_FAKE_STRIPE_URL ?? "http://127.0.0.1:3312";
export const communityEditionUrl = process.env.E2E_COMMUNITY_URL ?? "http://localhost:3311";
const webhookSecret = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_only_not_a_real_secret";

export const stripeHosts = /^https:\/\/(connect|checkout|billing)\.stripe\.test\//;

export interface StripeCall {
  readonly method: string;
  readonly path: string;
  readonly account: string | null;
  readonly idempotencyKey: string | null;
  readonly body: Record<string, string>;
}

type StripeObject = Record<string, unknown>;

export interface StripeObjects {
  readonly subscriptions?: Record<string, StripeObject>;
  readonly invoices?: Record<string, StripeObject>;
  readonly charges?: Record<string, StripeObject>;
  readonly application_fees?: Record<string, StripeObject>;
  readonly events?: Record<string, StripeObject>;
}

export async function stripeCalls(account: string): Promise<StripeCall[]> {
  const response = await fetch(
    `${fakeStripeUrl}/__control/calls?account=${encodeURIComponent(account)}`,
  );
  expect(response.ok, "fake Stripe lists calls").toBe(true);
  return (await response.json()) as StripeCall[];
}

export async function allStripeCalls(): Promise<StripeCall[]> {
  const response = await fetch(`${fakeStripeUrl}/__control/calls`);
  expect(response.ok, "fake Stripe lists calls").toBe(true);
  return (await response.json()) as StripeCall[];
}

export async function putStripeObjects(objects: StripeObjects): Promise<void> {
  const response = await fetch(`${fakeStripeUrl}/__control/objects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(objects),
  });
  expect(response.ok, "fake Stripe stores objects").toBe(true);
}

export interface StripeFailureRule {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly status?: number;
  readonly code?: string;
  readonly times?: number;
}

async function controlFailures(body: object): Promise<void> {
  const response = await fetch(`${fakeStripeUrl}/__control/failures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok, "fake Stripe accepts the failure rule").toBe(true);
}

export type ClearStripeFailure = () => Promise<void>;

export async function failStripe(rule: StripeFailureRule): Promise<ClearStripeFailure> {
  await controlFailures(rule);
  return () => controlFailures({ clear: true, method: rule.method, path: rule.path });
}

export interface WebhookResult {
  readonly status: number;
  readonly outcome: string | null;
}

export interface WebhookOptions {
  readonly id?: string;
  readonly account?: string | null;
  readonly secret?: string;
}

let eventCounter = 0;

function nextEventId(): string {
  eventCounter += 1;
  return `evt_e2e_${Date.now().toString(36)}_${eventCounter}`;
}

export async function sendWebhook(
  baseURL: string,
  type: string,
  object: StripeObject,
  options: WebhookOptions = {},
): Promise<WebhookResult> {
  const event = {
    id: options.id ?? nextEventId(),
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    ...(options.account ? { account: options.account } : {}),
    data: { object },
  };
  await putStripeObjects({ events: { [event.id]: event } });
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? webhookSecret,
  });
  const response = await fetch(`${baseURL}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  const body: unknown = await response.json().catch(() => null);
  const outcome =
    typeof body === "object" &&
    body !== null &&
    "outcome" in body &&
    typeof body.outcome === "string"
      ? body.outcome
      : null;
  return { status: response.status, outcome };
}

export async function deliverWebhook(
  baseURL: string,
  type: string,
  object: StripeObject,
  options: WebhookOptions = {},
): Promise<void> {
  const delivery = { ...options, id: options.id ?? nextEventId() };
  const first = await sendWebhook(baseURL, type, object, delivery);
  expect(first, `${type} webhook`).toEqual({ status: 200, outcome: "queued" });
  await expect
    .poll(async () => (await sendWebhook(baseURL, type, object, delivery)).outcome, {
      message: `${type} processed by the worker`,
      timeout: 30_000,
    })
    .toBe("duplicate");
}

export interface Purchase {
  readonly account: string;
  readonly communityId: string;
  readonly userId: string;
  readonly planId: string;
  readonly priceId: string;
  readonly suffix: string;
  readonly periodEnd: number;
}

export function purchaseIds(purchase: Purchase) {
  const { suffix } = purchase;
  return {
    subscription: `sub_e2e${suffix}`,
    customer: `cus_e2e${suffix}`,
    invoice: `in_e2e${suffix}`,
    paymentIntent: `pi_e2e${suffix}`,
    charge: `ch_e2e${suffix}`,
    fee: `fee_e2e${suffix}`,
  };
}

export function subscriptionObject(
  purchase: Purchase,
  status: "active" | "past_due" | "canceled",
  interval: "month" | "year",
  endedAt: number | null = null,
): StripeObject {
  const ids = purchaseIds(purchase);
  return {
    id: ids.subscription,
    object: "subscription",
    status,
    customer: ids.customer,
    metadata: {
      cohory_community_id: purchase.communityId,
      cohory_user_id: purchase.userId,
      cohory_plan_id: purchase.planId,
    },
    cancel_at_period_end: false,
    ended_at: endedAt,
    application_fee_percent: 2,
    items: {
      object: "list",
      data: [
        {
          id: `si_e2e${purchase.suffix}`,
          object: "subscription_item",
          current_period_end: purchase.periodEnd,
          price: { id: purchase.priceId, object: "price", recurring: { interval } },
        },
      ],
    },
  };
}

export function paidInvoiceObjects(purchase: Purchase, amountMinor: number, feeMinor: number) {
  const ids = purchaseIds(purchase);
  const now = Math.floor(Date.now() / 1000);
  return {
    invoices: {
      [ids.invoice]: {
        id: ids.invoice,
        object: "invoice",
        status: "paid",
        amount_paid: amountMinor,
        total: amountMinor,
        total_excluding_tax: amountMinor,
        currency: "usd",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: ids.subscription },
        },
        payments: {
          object: "list",
          data: [
            {
              id: `inpay_e2e${purchase.suffix}`,
              object: "invoice_payment",
              payment: { type: "payment_intent", payment_intent: ids.paymentIntent },
            },
          ],
        },
        status_transitions: { paid_at: now },
      },
    },
    charges: {
      [ids.charge]: {
        id: ids.charge,
        object: "charge",
        amount: amountMinor,
        amount_refunded: 0,
        currency: "usd",
        payment_intent: ids.paymentIntent,
        application_fee: ids.fee,
      },
    },
    application_fees: {
      [ids.fee]: {
        id: ids.fee,
        object: "application_fee",
        account: purchase.account,
        charge: ids.charge,
        amount: feeMinor,
        amount_refunded: 0,
        currency: "usd",
        created: now,
        refunds: { object: "list", data: [] },
      },
    },
  } satisfies StripeObjects;
}

export function failedInvoiceObject(purchase: Purchase, amountMinor: number): StripeObjects {
  const ids = purchaseIds(purchase);
  const id = `${ids.invoice}_retry`;
  return {
    invoices: {
      [id]: {
        id,
        object: "invoice",
        status: "open",
        amount_paid: 0,
        total: amountMinor,
        total_excluding_tax: amountMinor,
        currency: "usd",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: ids.subscription },
        },
        payments: { object: "list", data: [] },
        status_transitions: { paid_at: null },
      },
    },
  };
}
