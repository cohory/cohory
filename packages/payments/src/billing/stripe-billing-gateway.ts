import Stripe from "stripe";

import {
  parseVerifiedEvent,
  stripeClientConfig,
  type StripeGatewayOptions,
} from "../stripe-gateway";
import type {
  BillingCustomer,
  BillingGateway,
  BillingInvoice,
  BillingPaymentMethod,
} from "./gateway";

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.id;
}

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function paymentMethodOf(
  method: string | Stripe.PaymentMethod | null | undefined,
): BillingPaymentMethod | null {
  if (!method) {
    return null;
  }
  if (typeof method === "string") {
    return { id: method, label: "Payment method on file" };
  }
  if (method.card) {
    const brand = method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1);
    return { id: method.id, label: `${brand} ending ${method.card.last4}` };
  }
  if (method.us_bank_account) {
    return { id: method.id, label: `Bank account ending ${method.us_bank_account.last4 ?? ""}` };
  }
  if (method.sepa_debit) {
    return { id: method.id, label: `SEPA debit ending ${method.sepa_debit.last4 ?? ""}` };
  }
  return { id: method.id, label: "Payment method on file" };
}

function customerOf(customer: Stripe.Customer | Stripe.DeletedCustomer): BillingCustomer {
  if (customer.deleted) {
    return { id: customer.id, email: null, defaultPaymentMethod: null };
  }
  return {
    id: customer.id,
    email: customer.email ?? null,
    defaultPaymentMethod: paymentMethodOf(customer.invoice_settings.default_payment_method),
  };
}

export function billingInvoiceOf(invoice: Stripe.Invoice): BillingInvoice {
  if (!invoice.id) {
    throw new Error("invoice has no id");
  }
  return {
    id: invoice.id,
    customerId: idOf(invoice.customer),
    status: invoice.status ?? null,
    currency: invoice.currency,
    totalMinor: invoice.total,
    amountPaidMinor: invoice.amount_paid,
    number: invoice.number ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    dueAt: fromUnix(invoice.due_date),
    finalizedAt: fromUnix(invoice.status_transitions.finalized_at),
    paidAt: fromUnix(invoice.status_transitions.paid_at),
    attemptCount: invoice.attempt_count,
    metadata: invoice.metadata ?? {},
  };
}

const customerExpand = ["invoice_settings.default_payment_method"];

export function createStripeBillingGateway(
  secretKey: string,
  options: StripeGatewayOptions = {},
): BillingGateway {
  const stripe = new Stripe(secretKey, stripeClientConfig(options));

  return {
    async createCustomer(input, idempotencyKey) {
      const customer = await stripe.customers.create(
        {
          name: input.name,
          ...(input.email ? { email: input.email } : {}),
          metadata: { ...input.metadata },
        },
        { idempotencyKey },
      );
      return { id: customer.id };
    },

    async updateCustomerEmail(customerId, email, idempotencyKey) {
      await stripe.customers.update(customerId, { email }, { idempotencyKey });
    },

    async retrieveCustomer(customerId) {
      return customerOf(await stripe.customers.retrieve(customerId, { expand: customerExpand }));
    },

    async setDefaultPaymentMethod(customerId, paymentMethodId, idempotencyKey) {
      const customer = await stripe.customers.update(
        customerId,
        {
          invoice_settings: { default_payment_method: paymentMethodId },
          expand: customerExpand,
        },
        { idempotencyKey },
      );
      return customerOf(customer);
    },

    async createSetupSession(input, idempotencyKey) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer: input.customerId,
          currency: input.currency,
          allowed_payment_method_types: ["card"],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: { ...input.metadata },
          setup_intent_data: { metadata: { ...input.metadata } },
        },
        { idempotencyKey },
      );
      if (!session.url) {
        throw new Error("setup session has no url");
      }
      return { id: session.id, url: session.url };
    },

    async retrieveEvent(eventId) {
      return parseVerifiedEvent(await stripe.events.retrieve(eventId));
    },

    async retrieveSetupSession(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["setup_intent"],
      });
      const intent = session.setup_intent;
      return {
        id: session.id,
        customerId: idOf(session.customer),
        status: session.status ?? null,
        paymentMethodId: intent && typeof intent !== "string" ? idOf(intent.payment_method) : null,
        metadata: session.metadata ?? {},
      };
    },

    async createInvoice(input, idempotencyKey) {
      const invoice = await stripe.invoices.create(
        {
          customer: input.customerId,
          currency: input.currency,
          collection_method: input.collectionMethod,
          ...(input.collectionMethod === "send_invoice"
            ? { days_until_due: input.daysUntilDue }
            : {}),
          auto_advance: false,
          pending_invoice_items_behavior: "exclude",
          description: input.description,
          metadata: { ...input.metadata },
        },
        { idempotencyKey: `${idempotencyKey}:create` },
      );
      if (!invoice.id) {
        throw new Error("invoice has no id");
      }
      await stripe.invoiceItems.create(
        {
          customer: input.customerId,
          invoice: invoice.id,
          currency: input.currency,
          amount: input.amountMinor,
          description: input.description,
          metadata: { ...input.metadata },
        },
        { idempotencyKey: `${idempotencyKey}:item` },
      );
      return billingInvoiceOf(await stripe.invoices.retrieve(invoice.id));
    },

    async finalizeInvoice(invoiceId, idempotencyKey) {
      return billingInvoiceOf(
        await stripe.invoices.finalizeInvoice(
          invoiceId,
          { auto_advance: true },
          { idempotencyKey },
        ),
      );
    },

    async sendInvoice(invoiceId, idempotencyKey) {
      return billingInvoiceOf(await stripe.invoices.sendInvoice(invoiceId, {}, { idempotencyKey }));
    },

    async payInvoice(invoiceId, idempotencyKey) {
      return billingInvoiceOf(await stripe.invoices.pay(invoiceId, {}, { idempotencyKey }));
    },

    async voidInvoice(invoiceId, idempotencyKey) {
      return billingInvoiceOf(await stripe.invoices.voidInvoice(invoiceId, {}, { idempotencyKey }));
    },

    async retrieveInvoice(invoiceId) {
      return billingInvoiceOf(await stripe.invoices.retrieve(invoiceId));
    },
  };
}
