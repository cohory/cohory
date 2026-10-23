import type { PlatformInvoiceCollection } from "@cohory/db/schema";

import type { VerifiedEvent } from "../gateway";

export interface BillingCustomerInput {
  readonly name: string;
  readonly email: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface BillingPaymentMethod {
  readonly id: string;
  readonly label: string;
}

export interface BillingCustomer {
  readonly id: string;
  readonly email: string | null;
  readonly defaultPaymentMethod: BillingPaymentMethod | null;
}

export interface SetupSessionInput {
  readonly customerId: string;
  readonly currency: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface SetupSession {
  readonly id: string;
  readonly customerId: string | null;
  readonly status: string | null;
  readonly paymentMethodId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface BillingInvoiceInput {
  readonly customerId: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly description: string;
  readonly collectionMethod: PlatformInvoiceCollection;
  readonly daysUntilDue: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface BillingInvoice {
  readonly id: string;
  readonly customerId: string | null;
  readonly status: string | null;
  readonly currency: string;
  readonly totalMinor: number;
  readonly amountPaidMinor: number;
  readonly number: string | null;
  readonly hostedInvoiceUrl: string | null;
  readonly dueAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly paidAt: Date | null;
  readonly attemptCount: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface BillingGateway {
  createCustomer(input: BillingCustomerInput, idempotencyKey: string): Promise<{ id: string }>;
  updateCustomerEmail(customerId: string, email: string, idempotencyKey: string): Promise<void>;
  retrieveCustomer(customerId: string): Promise<BillingCustomer>;
  setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
    idempotencyKey: string,
  ): Promise<BillingCustomer>;
  createSetupSession(
    input: SetupSessionInput,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string }>;
  retrieveSetupSession(sessionId: string): Promise<SetupSession>;
  retrieveEvent(eventId: string): Promise<VerifiedEvent>;
  createInvoice(input: BillingInvoiceInput, idempotencyKey: string): Promise<BillingInvoice>;
  finalizeInvoice(invoiceId: string, idempotencyKey: string): Promise<BillingInvoice>;
  sendInvoice(invoiceId: string, idempotencyKey: string): Promise<BillingInvoice>;
  payInvoice(invoiceId: string, idempotencyKey: string): Promise<BillingInvoice>;
  voidInvoice(invoiceId: string, idempotencyKey: string): Promise<BillingInvoice>;
  retrieveInvoice(invoiceId: string): Promise<BillingInvoice>;
}
