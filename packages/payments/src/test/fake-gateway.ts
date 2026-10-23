import { randomUUID } from "node:crypto";

import Stripe from "stripe";

import type { WebhookDelivery } from "../service/webhooks";
import { parseVerifiedEvent } from "../stripe-gateway";
import type {
  AccountState,
  CheckoutInput,
  GatewayApplicationFee,
  GatewayCharge,
  GatewayDispute,
  GatewayInvoice,
  GatewaySubscription,
  GatewaySubscriptionSummary,
  PriceInput,
  StripeAccount,
  StripeGateway,
  VerifiedEvent,
} from "../gateway";

const signedEvents = new Map<string, VerifiedEvent>();

export function signedEventFor(eventId: string): VerifiedEvent {
  const event = signedEvents.get(eventId);
  if (!event) {
    throw new Error(`no signed event ${eventId}`);
  }
  return event;
}

export function rememberSignedEvent(rawBody: string): void {
  const event = parseVerifiedEvent(JSON.parse(rawBody));
  signedEvents.set(event.id, event);
}

export interface GatewayCall {
  readonly method: keyof StripeGateway;
  readonly account: StripeAccount;
  readonly idempotencyKey: string | null;
  readonly input: unknown;
}

export interface FakeCheckoutSession {
  readonly id: string;
  readonly account: StripeAccount;
  readonly metadata: Readonly<Record<string, string>>;
  readonly customerId: string | null;
  status: "open" | "complete" | "expired";
}

export interface FakeGateway extends StripeGateway {
  readonly calls: GatewayCall[];
  readonly deletedCustomers: Set<string>;
  readonly accounts: Map<string, AccountState>;
  readonly subscriptions: Map<string, GatewaySubscription>;
  readonly summaries: Map<string, GatewaySubscriptionSummary>;
  readonly invoices: Map<string, GatewayInvoice>;
  readonly charges: Map<string, GatewayCharge>;
  readonly fees: Map<string, GatewayApplicationFee>;
  readonly disputes: Map<string, GatewayDispute>;
  readonly prices: Map<string, PriceInput>;
  readonly checkoutSessions: Map<string, FakeCheckoutSession>;
  lastCheckout(): CheckoutInput | null;
  writes(method: keyof StripeGateway): GatewayCall[];
  failOn(method: keyof StripeGateway, subscriptionId: string, error: Error, times?: number): void;
}

interface FailureRule {
  readonly method: keyof StripeGateway;
  readonly subscriptionId: string;
  readonly error: Error;
  remaining: number;
}

export function createFakeGateway(options: { ownAccountId?: string } = {}): FakeGateway {
  const calls: GatewayCall[] = [];
  const accounts = new Map<string, AccountState>();
  const subscriptions = new Map<string, GatewaySubscription>();
  const summaries = new Map<string, GatewaySubscriptionSummary>();
  const invoices = new Map<string, GatewayInvoice>();
  const charges = new Map<string, GatewayCharge>();
  const fees = new Map<string, GatewayApplicationFee>();
  const disputes = new Map<string, GatewayDispute>();
  const prices = new Map<string, PriceInput>();
  const checkoutSessions = new Map<string, FakeCheckoutSession>();
  const deletedCustomers = new Set<string>();
  const byKey = new Map<string, unknown>();
  const keyedRequests = new Map<string, string>();
  const failures: FailureRule[] = [];
  const run = randomUUID().slice(0, 8);
  const ownAccountId = options.ownAccountId ?? `acct_own${run}`;
  let counter = 0;

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}_fake${run}${counter}`;
  }

  function once<T>(key: string, make: () => T): T {
    if (byKey.has(key)) {
      return byKey.get(key) as T;
    }
    const value = make();
    byKey.set(key, value);
    return value;
  }

  function rejectReusedKey(
    method: keyof StripeGateway,
    account: StripeAccount,
    key: string,
    input: unknown,
  ): void {
    const scope = `${account ?? "platform"}:${key}`;
    const request = JSON.stringify({ method, input });
    const first = keyedRequests.get(scope);
    if (first === undefined) {
      keyedRequests.set(scope, request);
      return;
    }
    if (first !== request) {
      throw new Stripe.errors.StripeIdempotencyError({
        type: "idempotency_error",
        message:
          "Keys for idempotent requests can only be used with the same parameters they were first used with.",
      });
    }
  }

  function log(
    method: keyof StripeGateway,
    account: StripeAccount,
    key: string | null,
    input: unknown,
  ) {
    calls.push({ method, account, idempotencyKey: key, input });
    if (key !== null) {
      rejectReusedKey(method, account, key, input);
    }
  }

  function failIfRuled(method: keyof StripeGateway, subscriptionId: string): void {
    const rule = failures.find(
      (item) =>
        item.method === method && item.subscriptionId === subscriptionId && item.remaining > 0,
    );
    if (rule) {
      rule.remaining -= 1;
      throw rule.error;
    }
  }

  function need<T>(map: Map<string, T>, id: string): T {
    const value = map.get(id);
    if (!value) {
      throw new Error(`fake gateway has no ${id}`);
    }
    return value;
  }

  return {
    calls,
    deletedCustomers,
    accounts,
    subscriptions,
    summaries,
    invoices,
    charges,
    fees,
    disputes,
    prices,
    checkoutSessions,

    lastCheckout() {
      const call = calls.filter((c) => c.method === "createCheckoutSession").at(-1);
      return call ? (call.input as CheckoutInput) : null;
    },

    writes(method) {
      return calls.filter((c) => c.method === method);
    },

    failOn(method, subscriptionId, error, times = Number.POSITIVE_INFINITY) {
      failures.push({ method, subscriptionId, error, remaining: times });
    },

    async createConnectedAccount(input, key) {
      log("createConnectedAccount", null, key, input);
      return once(key, () => {
        const state = {
          id: nextId("acct"),
          chargesEnabled: false,
          detailsSubmitted: false,
          livemode: false,
          country: input.country,
        };
        accounts.set(state.id, state);
        return state;
      });
    },

    async retrieveConnectedAccount(accountId) {
      return need(accounts, accountId);
    },

    async createOnboardingLink(input, key) {
      log("createOnboardingLink", input.accountId, key, input);
      return { url: `https://connect.stripe.test/setup/${input.accountId}` };
    },

    async retrieveOwnAccount() {
      return {
        id: ownAccountId,
        chargesEnabled: true,
        detailsSubmitted: true,
        livemode: false,
        country: "us",
      };
    },

    async createProduct(account, input, key) {
      log("createProduct", account, key, input);
      return once(key, () => ({ id: nextId("prod") }));
    },

    async createPrice(account, input, key) {
      log("createPrice", account, key, input);
      return once(key, () => {
        const id = nextId("price");
        prices.set(id, input);
        return { id };
      });
    },

    async updateProduct(account, productId, input, key) {
      log("updateProduct", account, key, { productId, ...input });
    },

    async deactivatePrice(account, priceId, key) {
      log("deactivatePrice", account, key, { priceId });
    },

    async createCheckoutSession(account, input, key) {
      log("createCheckoutSession", account, key, input);
      return once(key, () => {
        const id = nextId("cs");
        checkoutSessions.set(id, {
          id,
          account,
          metadata: input.metadata,
          customerId: input.customerId,
          status: "open",
        });
        return { id, url: `https://checkout.stripe.test/${id}` };
      });
    },

    async expireOpenCheckoutSessions(account, match, prefix) {
      const expired: string[] = [];
      for (const session of checkoutSessions.values()) {
        const matches = Object.entries(match.metadata).every(
          ([key, value]) => session.metadata[key] === value,
        );
        if (
          session.account !== account ||
          session.status !== "open" ||
          (match.customerId !== null && session.customerId !== match.customerId) ||
          session.id === match.keepSessionId ||
          !matches
        ) {
          continue;
        }
        log("expireOpenCheckoutSessions", account, `${prefix}:${session.id}`, {
          sessionId: session.id,
        });
        session.status = "expired";
        expired.push(session.id);
      }
      return expired;
    },

    async createPortalSession(account, input, key) {
      log("createPortalSession", account, key, input);
      return { url: `https://billing.stripe.test/${input.customerId}` };
    },

    async retrieveSubscription(account, subscriptionId) {
      log("retrieveSubscription", account, null, { subscriptionId });
      failIfRuled("retrieveSubscription", subscriptionId);
      return need(subscriptions, subscriptionId);
    },

    async listSubscriptions(account, input) {
      log("listSubscriptions", account, null, input);
      const all = [...summaries.values()];
      const start = input.startingAfter
        ? all.findIndex((item) => item.id === input.startingAfter) + 1
        : 0;
      const items = all.slice(start, start + input.limit);
      const more = start + input.limit < all.length;
      return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
    },

    async retrieveSubscriptionSummary(account, subscriptionId) {
      log("retrieveSubscriptionSummary", account, null, { subscriptionId });
      return need(summaries, subscriptionId);
    },

    async setSubscriptionApplicationFee(account, subscriptionId, percent, key) {
      log("setSubscriptionApplicationFee", account, key, { subscriptionId, percent });
      failIfRuled("setSubscriptionApplicationFee", subscriptionId);
      const updated = { ...need(subscriptions, subscriptionId), applicationFeePercent: percent };
      subscriptions.set(subscriptionId, updated);
      const summary = summaries.get(subscriptionId);
      if (summary) {
        summaries.set(subscriptionId, { ...summary, applicationFeePercent: percent });
      }
      return updated;
    },

    async retrieveInvoice(account, invoiceId) {
      return need(invoices, invoiceId);
    },

    async listPaidInvoices(account, subscriptionId) {
      return [...invoices.values()].filter(
        (invoice) => invoice.subscriptionId === subscriptionId && invoice.status === "paid",
      );
    },

    async retrieveEvent(account, eventId) {
      log("retrieveEvent", account, null, { eventId });
      failIfRuled("retrieveEvent", eventId);
      return signedEventFor(eventId);
    },

    async retrieveCharge(account, chargeId) {
      return need(charges, chargeId);
    },

    async listCharges(account, input) {
      log("listCharges", account, null, input);
      const all = [...charges.values()];
      const start = input.startingAfter
        ? all.findIndex((item) => item.id === input.startingAfter) + 1
        : 0;
      const items = all.slice(start, start + input.limit);
      const more = start + input.limit < all.length;
      return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
    },

    async retrieveDispute(account, disputeId) {
      return need(disputes, disputeId);
    },

    async retrieveApplicationFee(feeId) {
      return need(fees, feeId);
    },

    async clearSubscriptionApplicationFee(account, subscriptionId, key) {
      log("clearSubscriptionApplicationFee", account, key, { subscriptionId });
      failIfRuled("clearSubscriptionApplicationFee", subscriptionId);
      const subscription = need(subscriptions, subscriptionId);
      const cleared = { ...subscription, applicationFeePercent: null };
      subscriptions.set(subscriptionId, cleared);
      return cleared;
    },

    async cancelSubscription(account, subscriptionId, key, comment) {
      log("cancelSubscription", account, key, {
        subscriptionId,
        ...(comment ? { comment } : {}),
      });
      failIfRuled("cancelSubscription", subscriptionId);
      const subscription = need(subscriptions, subscriptionId);
      const canceled = {
        ...subscription,
        status: "canceled",
        endedAt: new Date(),
        cancellationComment: comment ?? null,
      };
      subscriptions.set(subscriptionId, canceled);
      return canceled;
    },

    async pauseSubscription(account, subscriptionId, input, key) {
      log("pauseSubscription", account, key, { subscriptionId, ...input });
      failIfRuled("pauseSubscription", subscriptionId);
      const paused = {
        ...need(subscriptions, subscriptionId),
        status: "paused",
        currentPeriodEnd: input.paidThrough,
      };
      subscriptions.set(subscriptionId, paused);
      return paused;
    },

    async resumeSubscription(account, subscriptionId, key) {
      log("resumeSubscription", account, key, { subscriptionId });
      failIfRuled("resumeSubscription", subscriptionId);
      const resumed = { ...need(subscriptions, subscriptionId), status: "active" };
      subscriptions.set(subscriptionId, resumed);
      return resumed;
    },

    async setCancellationDetails(account, subscriptionId, details, key) {
      log("setCancellationDetails", account, key, { subscriptionId, ...details });
      failIfRuled("setCancellationDetails", subscriptionId);
    },

    async scheduleCancellation(account, subscriptionId, key) {
      log("scheduleCancellation", account, key, { subscriptionId });
      failIfRuled("scheduleCancellation", subscriptionId);
      const scheduled = { ...need(subscriptions, subscriptionId), cancelAtPeriodEnd: true };
      subscriptions.set(subscriptionId, scheduled);
      return scheduled;
    },

    async createRefund(account, input, key) {
      log("createRefund", account, key, input);
      failIfRuled("createRefund", input.paymentIntentId);
      const invoice = [...invoices.values()].find((item) =>
        item.paymentIntentIds.includes(input.paymentIntentId),
      );
      return once(key, () => ({
        id: nextId("re"),
        amount: input.amountMinor ?? invoice?.amountPaid ?? 0,
        currency: invoice?.currency ?? "usd",
        status: "succeeded",
      }));
    },

    async deleteCustomer(account, customerId, key) {
      log("deleteCustomer", account, key, { customerId });
      deletedCustomers.add(customerId);
    },

    async refundApplicationFee(feeId, amountMinor, key, disputeId) {
      log("refundApplicationFee", null, key, {
        feeId,
        amountMinor,
        ...(disputeId ? { disputeId } : {}),
      });
      once(key, () => {
        const fee = need(fees, feeId);
        fees.set(feeId, {
          ...fee,
          amountRefunded: fee.amountRefunded + amountMinor,
          refunds: [
            ...fee.refunds,
            {
              id: nextId("fr"),
              amount: amountMinor,
              currency: fee.currency,
              createdAt: new Date(),
              disputeId,
            },
          ],
        });
        return true;
      });
    },
  };
}

export interface SignedEvent {
  readonly rawBody: string;
  readonly signature: string;
}

export function signedEvent(
  type: string,
  object: Record<string, unknown> & { id: string },
  options: { account?: string | null; secret?: string; livemode?: boolean; id?: string } = {},
): SignedEvent & { id: string } {
  const id = options.id ?? `evt_test_${randomUUID()}`;
  const rawBody = JSON.stringify({
    id,
    object: "event",
    type,
    livemode: options.livemode ?? false,
    created: Math.floor(Date.now() / 1000),
    ...(options.account ? { account: options.account } : {}),
    data: { object },
  });
  rememberSignedEvent(rawBody);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: options.secret ?? "whsec_connect",
  });
  return { id, rawBody, signature };
}

export function stripeDelivery(request: {
  readonly rawBody: string;
  readonly signature: string | null;
}): WebhookDelivery {
  return { rawBody: request.rawBody, headers: { "stripe-signature": request.signature } };
}
