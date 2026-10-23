import { randomUUID } from "node:crypto";

import { signedEventFor } from "../../test/fake-gateway";
import type {
  BillingCustomer,
  BillingGateway,
  BillingInvoice,
  BillingInvoiceInput,
  SetupSession,
} from "../gateway";

export interface BillingCall {
  readonly method: keyof BillingGateway;
  readonly idempotencyKey: string | null;
}

export interface FakeBillingGateway extends BillingGateway {
  readonly calls: BillingCall[];
  readonly customers: Map<string, BillingCustomer>;
  readonly invoices: Map<string, BillingInvoice>;
  readonly inputs: Map<string, BillingInvoiceInput>;
  readonly sessions: Map<string, SetupSession>;
  failNextPayment: boolean;
  completeSetup(sessionId: string, paymentMethodId: string): void;
  markPaid(invoiceId: string, at: Date): void;
  writes(method: keyof BillingGateway): BillingCall[];
}

class FakeCardError extends Error {
  readonly type = "StripeCardError";
  readonly code = "card_declined";
}

export function createFakeBillingGateway(): FakeBillingGateway {
  const calls: BillingCall[] = [];
  const customers = new Map<string, BillingCustomer>();
  const invoices = new Map<string, BillingInvoice>();
  const inputs = new Map<string, BillingInvoiceInput>();
  const sessions = new Map<string, SetupSession>();
  const byKey = new Map<string, unknown>();
  const keyedRequests = new Map<string, string>();
  const run = randomUUID().slice(0, 8);
  let counter = 0;

  const nextId = (prefix: string) => {
    counter += 1;
    return `${prefix}_fake${run}${counter}`;
  };

  function rejectReusedKey(method: keyof BillingGateway, key: string, params: unknown): void {
    const request = JSON.stringify({ method, params });
    const first = keyedRequests.get(key);
    if (first === undefined) {
      keyedRequests.set(key, request);
      return;
    }
    if (first !== request) {
      throw Object.assign(
        new Error(
          "Keys for idempotent requests can only be used with the same parameters they were first used with.",
        ),
        { type: "StripeIdempotencyError", code: "idempotency_key_in_use" },
      );
    }
  }

  function once<T>(method: keyof BillingGateway, key: string, params: unknown, make: () => T): T {
    calls.push({ method, idempotencyKey: key });
    rejectReusedKey(method, key, params);
    if (byKey.has(key)) {
      return byKey.get(key) as T;
    }
    const value = make();
    byKey.set(key, value);
    return value;
  }

  function invoice(id: string): BillingInvoice {
    const found = invoices.get(id);
    if (!found) {
      throw Object.assign(new Error("No such invoice"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
      });
    }
    return found;
  }

  function update(id: string, patch: Partial<BillingInvoice>): BillingInvoice {
    const next = { ...invoice(id), ...patch };
    invoices.set(id, next);
    return next;
  }

  const gateway: FakeBillingGateway = {
    calls,
    customers,
    invoices,
    inputs,
    sessions,
    failNextPayment: false,

    completeSetup(sessionId, paymentMethodId) {
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status: "complete", paymentMethodId });
      }
    },

    markPaid(id, at) {
      update(id, { status: "paid", amountPaidMinor: invoice(id).totalMinor, paidAt: at });
    },

    writes(method) {
      return calls.filter((call) => call.method === method);
    },

    async createCustomer(input, key) {
      return once("createCustomer", key, input, () => {
        const id = nextId("cus");
        customers.set(id, { id, email: input.email, defaultPaymentMethod: null });
        return { id };
      });
    },

    async updateCustomerEmail(customerId, email, key) {
      once("updateCustomerEmail", key, { customerId, email }, () => {
        const customer = customers.get(customerId);
        if (customer) customers.set(customerId, { ...customer, email });
        return null;
      });
    },

    async retrieveCustomer(customerId) {
      const customer = customers.get(customerId);
      if (!customer) throw new Error("no such customer");
      return customer;
    },

    async setDefaultPaymentMethod(customerId, paymentMethodId, key) {
      return once("setDefaultPaymentMethod", key, { customerId, paymentMethodId }, () => {
        const customer = customers.get(customerId);
        if (!customer) throw new Error("no such customer");
        const next = {
          ...customer,
          defaultPaymentMethod: { id: paymentMethodId, label: "Visa ending 4242" },
        };
        customers.set(customerId, next);
        return next;
      });
    },

    async createSetupSession(input, key) {
      return once("createSetupSession", key, input, () => {
        const id = nextId("cs_test");
        sessions.set(id, {
          id,
          customerId: input.customerId,
          status: "open",
          paymentMethodId: null,
          metadata: input.metadata,
        });
        return { id, url: `https://checkout.stripe.test/${id}` };
      });
    },

    async retrieveEvent(eventId) {
      calls.push({ method: "retrieveEvent", idempotencyKey: null });
      return signedEventFor(eventId);
    },

    async retrieveSetupSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("no such session");
      return session;
    },

    async createInvoice(input, key) {
      return once("createInvoice", key, input, () => {
        const id = nextId("in");
        inputs.set(id, input);
        const created: BillingInvoice = {
          id,
          customerId: input.customerId,
          status: "draft",
          currency: input.currency,
          totalMinor: input.amountMinor,
          amountPaidMinor: 0,
          number: null,
          hostedInvoiceUrl: null,
          dueAt: null,
          finalizedAt: null,
          paidAt: null,
          attemptCount: 0,
          metadata: input.metadata,
        };
        invoices.set(id, created);
        return created;
      });
    },

    async finalizeInvoice(id, key) {
      return once("finalizeInvoice", key, { id }, () => {
        const current = invoice(id);
        const input = inputs.get(id);
        const finalizedAt = new Date("2026-11-01T01:00:00.000Z");
        return update(id, {
          status: "open",
          number: `CHY-${counter}`,
          hostedInvoiceUrl: `https://invoice.stripe.test/${current.id}`,
          finalizedAt,
          dueAt:
            input?.collectionMethod === "send_invoice"
              ? new Date(finalizedAt.getTime() + input.daysUntilDue * 86_400_000)
              : null,
        });
      });
    },

    async sendInvoice(id, key) {
      return once("sendInvoice", key, { id }, () => invoice(id));
    },

    async payInvoice(id, key) {
      calls.push({ method: "payInvoice", idempotencyKey: key });
      rejectReusedKey("payInvoice", key, { id });
      if (gateway.failNextPayment) {
        gateway.failNextPayment = false;
        update(id, { attemptCount: invoice(id).attemptCount + 1 });
        throw new FakeCardError("Your card was declined.");
      }
      const current = invoice(id);
      return update(id, {
        status: "paid",
        amountPaidMinor: current.totalMinor,
        paidAt: new Date("2026-11-01T01:00:00.000Z"),
        attemptCount: current.attemptCount + 1,
      });
    },

    async voidInvoice(id, key) {
      return once("voidInvoice", key, { id }, () => update(id, { status: "void" }));
    },

    async retrieveInvoice(id) {
      return invoice(id);
    },
  };
  return gateway;
}
