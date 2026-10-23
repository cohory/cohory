import type { PlatformBillingIssueKind, PlatformInvoiceStatus } from "@cohory/db/schema";

import type { InvoiceDisplayStatus } from "./status";

export interface PlatformFeeBalanceView {
  readonly currency: string;
  readonly currentMinor: number;
  readonly carriedMinor: number;
  readonly minimumMinor: number;
}

export interface PlatformInvoiceView {
  readonly id: string;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly amountMinor: number;
  readonly amountPaidMinor: number;
  readonly status: PlatformInvoiceStatus;
  readonly displayStatus: InvoiceDisplayStatus;
  readonly number: string | null;
  readonly hostedInvoiceUrl: string | null;
  readonly dueAt: Date | null;
  readonly paidAt: Date | null;
  readonly pastDueSince: Date | null;
}

export interface PlatformBillingIssueView {
  readonly id: string;
  readonly kind: PlatformBillingIssueKind;
  readonly currency: string;
  readonly periodStart: Date;
  readonly expectedMinor: number | null;
  readonly actualMinor: number | null;
  readonly detectedAt: Date;
}

export interface PlatformFeesView {
  readonly available: boolean;
  readonly feeBps: number;
  readonly periodStart: Date;
  readonly nextInvoiceAt: Date;
  readonly balances: readonly PlatformFeeBalanceView[];
  readonly billingEmail: string | null;
  readonly ownerEmail: string | null;
  readonly paymentMethodLabel: string | null;
  readonly suspended: boolean;
  readonly canManage: boolean;
  readonly invoices: readonly PlatformInvoiceView[];
  readonly issues: readonly PlatformBillingIssueView[];
}
