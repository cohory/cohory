import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  char,
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { citext, id, timestamps } from "./columns";
import {
  communityOrFormer,
  detachedTenant,
  detachSnapshotWrite,
  formerCommunity,
  tenant,
} from "./communities";
import { feeLedgerEntries } from "./payments";

export const platformInvoiceStatus = pgEnum("platform_invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);
export const platformInvoiceCollection = pgEnum("platform_invoice_collection", [
  "charge_automatically",
  "send_invoice",
]);
export const platformBillingIssueKind = pgEnum("platform_billing_issue_kind", [
  "stripe_amount_mismatch",
  "ledger_amount_mismatch",
  "provider_total_mismatch",
  "stripe_invoice_missing",
]);

export type PlatformInvoiceStatus = (typeof platformInvoiceStatus.enumValues)[number];
export type PlatformInvoiceCollection = (typeof platformInvoiceCollection.enumValues)[number];
export type PlatformBillingIssueKind = (typeof platformBillingIssueKind.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.payments_manager', true), '') = 'on'`;
const isBilling = sql`coalesce(current_setting('app.platform_billing', true), '') = 'on'`;

const money = (name: string) => bigint(`${name}_minor`, { mode: "number" });

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

function billingRead(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: sql`(${inCommunity(communityId)} and ${isManager}) or ${isBilling}`,
  });
}

function billingWrite(name: string, communityId: AnyPgColumn, allowManager: boolean) {
  const writer = allowManager ? sql`(${isBilling} or ${isManager})` : isBilling;
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${inCommunity(communityId)} and ${writer}`,
    withCheck: sql`${inCommunity(communityId)} and ${writer}`,
  });
}

function currencyCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[a-z]{3}$'`);
}

export const platformBillingAccounts = pgTable(
  "platform_billing_accounts",
  {
    id: id(),
    communityId: detachedTenant(),
    ...formerCommunity(),
    stripeCustomerId: text("stripe_customer_id"),
    billingEmail: citext("billing_email"),
    paymentMethodId: text("payment_method_id"),
    paymentMethodLabel: text("payment_method_label"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("platform_billing_accounts_community_unique").on(t.communityId),
    uniqueIndex("platform_billing_accounts_customer_unique")
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} is not null`),
    check(
      "platform_billing_accounts_label_length",
      sql`char_length(${t.paymentMethodLabel}) <= 80`,
    ),
    ...communityOrFormer("platform_billing_accounts", t.communityId, t.formerCommunityId),
    billingRead("platform_billing_accounts_read", t.communityId),
    billingWrite("platform_billing_accounts_write", t.communityId, true),
    detachSnapshotWrite("platform_billing_accounts", t.communityId),
  ],
);

export const platformInvoices = pgTable(
  "platform_invoices",
  {
    id: id(),
    communityId: detachedTenant(),
    ...formerCommunity(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => platformBillingAccounts.id),
    currency: char("currency", { length: 3 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    amountMinor: money("amount").notNull(),
    amountPaidMinor: money("amount_paid").notNull().default(0),
    status: platformInvoiceStatus("status").notNull().default("draft"),
    collectionMethod: platformInvoiceCollection("collection_method").notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    invoiceNumber: text("invoice_number"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    ownerNotifiedAt: timestamp("owner_notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("platform_invoices_period_unique").on(t.communityId, t.currency, t.periodStart),
    uniqueIndex("platform_invoices_stripe_unique")
      .on(t.stripeInvoiceId)
      .where(sql`${t.stripeInvoiceId} is not null`),
    index("platform_invoices_community_period_idx").on(t.communityId, t.periodStart),
    index("platform_invoices_account_idx").on(t.billingAccountId),
    index("platform_invoices_open_idx")
      .on(t.status)
      .where(sql`${t.status} in ('draft', 'open')`),
    currencyCheck("platform_invoices_currency_format", t.currency),
    check("platform_invoices_amount_positive", sql`${t.amountMinor} > 0`),
    check("platform_invoices_paid_range", sql`${t.amountPaidMinor} >= 0`),
    check("platform_invoices_period_order", sql`${t.periodStart} < ${t.periodEnd}`),
    ...communityOrFormer("platform_invoices", t.communityId, t.formerCommunityId),
    billingRead("platform_invoices_read", t.communityId),
    billingWrite("platform_invoices_write", t.communityId, false),
    detachSnapshotWrite("platform_invoices", t.communityId),
  ],
);

export const platformInvoiceLines = pgTable(
  "platform_invoice_lines",
  {
    id: id(),
    communityId: detachedTenant(),
    ...formerCommunity(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => platformInvoices.id),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => feeLedgerEntries.id),
    amountMinor: money("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("platform_invoice_lines_entry_unique").on(t.ledgerEntryId),
    index("platform_invoice_lines_community_invoice_idx").on(t.communityId, t.invoiceId),
    index("platform_invoice_lines_invoice_idx").on(t.invoiceId),
    ...communityOrFormer("platform_invoice_lines", t.communityId, t.formerCommunityId),
    billingRead("platform_invoice_lines_read", t.communityId),
    billingWrite("platform_invoice_lines_write", t.communityId, false),
    detachSnapshotWrite("platform_invoice_lines", t.communityId),
  ],
);

export const platformBillingIssues = pgTable(
  "platform_billing_issues",
  {
    id: id(),
    communityId: tenant(),
    invoiceId: uuid("invoice_id").references(() => platformInvoices.id),
    kind: platformBillingIssueKind("kind").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    expectedMinor: money("expected"),
    actualMinor: money("actual"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("platform_billing_issues_one_open")
      .on(t.communityId, t.currency, t.periodStart, t.kind)
      .where(sql`${t.resolvedAt} is null`),
    index("platform_billing_issues_community_detected_idx").on(t.communityId, t.detectedAt),
    index("platform_billing_issues_invoice_idx")
      .on(t.invoiceId)
      .where(sql`${t.invoiceId} is not null`),
    currencyCheck("platform_billing_issues_currency_format", t.currency),
    billingRead("platform_billing_issues_read", t.communityId),
    billingWrite("platform_billing_issues_write", t.communityId, false),
  ],
);

export const feeLedgerBillingRead = pgPolicy("fee_ledger_entries_billing_read", {
  as: "permissive",
  for: "select",
  to: "public",
  using: isBilling,
}).link(feeLedgerEntries);
