import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { citext, id, timestamps } from "./columns";
import {
  communities,
  communityOrFormer,
  detachedTenant,
  detachSnapshotWrite,
  formerCommunity,
  tenant,
} from "./communities";
import { accountPurgeOwnRows } from "./identity";

export const paymentProvider = pgEnum("payment_provider", [
  "stripe_connect",
  "stripe_own_keys",
  "polar",
]);
export const paymentConnectionStatus = pgEnum("payment_connection_status", [
  "onboarding",
  "active",
  "restricted",
  "disconnected",
  "disconnecting",
]);
export const subscriptionAccessState = pgEnum("subscription_access_state", [
  "none",
  "granted",
  "grace",
  "revoked",
]);
export const planInterval = pgEnum("plan_interval", ["month", "year"]);
export const feeLedgerKind = pgEnum("fee_ledger_kind", [
  "fee_accrued",
  "fee_collected",
  "fee_refunded",
  "adjustment",
  "invoice_settled",
]);
export const feeLedgerReason = pgEnum("fee_ledger_reason", ["dispute_lost"]);
export const paymentDisputeStatus = pgEnum("payment_dispute_status", ["open", "won", "lost"]);
export const compEndReason = pgEnum("comp_end_reason", ["revoked", "expired"]);
export const subscriptionLinkStatus = pgEnum("subscription_link_status", ["linked", "invited"]);
export const feeCollectionMethod = pgEnum("fee_collection_method", [
  "automatic_split",
  "periodic_invoice",
]);

export const paymentExitKind = pgEnum("payment_exit_kind", ["archive", "disconnect", "delete"]);
export const paymentExitChoice = pgEnum("payment_exit_choice", [
  "stop_at_period_end",
  "keep_billing",
  "take_members",
  "wind_down",
  "cancel_now",
]);
export const paymentExitStatus = pgEnum("payment_exit_status", [
  "pending",
  "running",
  "failed",
  "done",
]);

export type PaymentProvider = (typeof paymentProvider.enumValues)[number];
export type PaymentConnectionStatus = (typeof paymentConnectionStatus.enumValues)[number];
export type SubscriptionAccessState = (typeof subscriptionAccessState.enumValues)[number];
export type PlanInterval = (typeof planInterval.enumValues)[number];
export type FeeLedgerKind = (typeof feeLedgerKind.enumValues)[number];
export type FeeLedgerReason = (typeof feeLedgerReason.enumValues)[number];
export type PaymentDisputeStatus = (typeof paymentDisputeStatus.enumValues)[number];
export type CompEndReason = (typeof compEndReason.enumValues)[number];
export type SubscriptionLinkStatus = (typeof subscriptionLinkStatus.enumValues)[number];
export type PaymentExitKind = (typeof paymentExitKind.enumValues)[number];
export type PaymentExitChoice = (typeof paymentExitChoice.enumValues)[number];
export type PaymentExitStatus = (typeof paymentExitStatus.enumValues)[number];

export const compNoteMaxLength = 200;

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.payments_manager', true), '') = 'on'`;
const isWebhook = sql`coalesce(current_setting('app.payments_webhook', true), '') = 'on'`;

const money = (name: string) => bigint(`${name}_minor`, { mode: "number" });
const currency = () => char("currency", { length: 3 }).notNull();

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

function communityRead(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: inCommunity(communityId),
  });
}

function ownOrManagerRead(name: string, communityId: AnyPgColumn, userId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: sql`${inCommunity(communityId)} and (${userId} = ${currentUser} or ${isManager})`,
  });
}

function managerWrite(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${inCommunity(communityId)} and ${isManager}`,
    withCheck: sql`${inCommunity(communityId)} and ${isManager}`,
  });
}

function currencyCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[a-z]{3}$'`);
}

export const paymentConnections = pgTable(
  "payment_connections",
  {
    id: id(),
    communityId: tenant(),
    provider: paymentProvider("provider").notNull(),
    externalAccountId: text("external_account_id"),
    encryptedSecret: text("encrypted_secret"),
    webhookSecretEncrypted: text("webhook_secret_encrypted"),
    status: paymentConnectionStatus("status").notNull(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    livemode: boolean("livemode").notNull().default(false),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    acceptedOwnerId: uuid("accepted_owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payment_connections_one_open_per_community")
      .on(t.communityId)
      .where(sql`${t.status} <> 'disconnected'`),
    uniqueIndex("payment_connections_open_account_unique")
      .on(t.externalAccountId)
      .where(sql`${t.status} <> 'disconnected' and ${t.externalAccountId} is not null`),
    index("payment_connections_accepted_owner_idx")
      .on(t.acceptedOwnerId)
      .where(sql`${t.acceptedOwnerId} is not null`),
    check(
      "payment_connections_own_keys_secret",
      sql`${t.provider} <> 'stripe_own_keys' or ${t.status} = 'disconnected' or (${t.encryptedSecret} is not null and ${t.webhookSecretEncrypted} is not null)`,
    ),
    check(
      "payment_connections_polar_secret",
      sql`${t.provider}::text <> 'polar' or ${t.status} = 'disconnected' or ${t.encryptedSecret} is not null`,
    ),
    communityRead("payment_connections_read", t.communityId),
    managerWrite("payment_connections_manage", t.communityId),
    pgPolicy("payment_connections_webhook_lookup", {
      as: "permissive",
      for: "select",
      to: "public",
      using: isWebhook,
    }),
  ],
);

export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: id(),
    communityId: tenant(),
    connectionId: uuid("connection_id").references(() => paymentConnections.id),
    name: text("name").notNull(),
    currency: currency(),
    monthlyPriceMinor: money("monthly_price").notNull(),
    annualPriceMinor: money("annual_price"),
    providerProductId: text("provider_product_id"),
    providerMonthlyPriceId: text("provider_monthly_price_id"),
    providerAnnualPriceId: text("provider_annual_price_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("membership_plans_one_active_per_community")
      .on(t.communityId)
      .where(sql`${t.archivedAt} is null`),
    index("membership_plans_community_created_idx").on(t.communityId, t.createdAt),
    index("membership_plans_connection_id_idx")
      .on(t.connectionId)
      .where(sql`${t.connectionId} is not null`),
    check("membership_plans_name_length", sql`char_length(${t.name}) between 1 and 80`),
    currencyCheck("membership_plans_currency_format", t.currency),
    check("membership_plans_monthly_positive", sql`${t.monthlyPriceMinor} > 0`),
    check(
      "membership_plans_annual_positive",
      sql`${t.annualPriceMinor} is null or ${t.annualPriceMinor} > 0`,
    ),
    communityRead("membership_plans_read", t.communityId),
    managerWrite("membership_plans_manage", t.communityId),
  ],
);

export const paymentCustomers = pgTable(
  "payment_customers",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => paymentConnections.id),
    externalCustomerId: text("external_customer_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("payment_customers_connection_external_unique").on(t.connectionId, t.externalCustomerId),
    index("payment_customers_community_user_idx").on(t.communityId, t.userId),
    ownOrManagerRead("payment_customers_read", t.communityId, t.userId),
    managerWrite("payment_customers_manage", t.communityId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => paymentCustomers.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => paymentConnections.id),
    planId: uuid("plan_id").references(() => membershipPlans.id),
    externalSubscriptionId: text("external_subscription_id").notNull(),
    providerStatus: text("provider_status").notNull(),
    accessState: subscriptionAccessState("access_state").notNull(),
    interval: planInterval("interval"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    applicationFeeBps: integer("application_fee_bps").notNull(),
    origin: text("origin").notNull().default("created_by_cohory"),
    externalPriceId: text("external_price_id"),
    providerFetchedAt: timestamp("provider_fetched_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("subscriptions_external_unique").on(t.externalSubscriptionId),
    index("subscriptions_community_user_idx").on(t.communityId, t.userId),
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_customer_id_idx").on(t.customerId),
    index("subscriptions_connection_id_idx").on(t.connectionId),
    index("subscriptions_plan_id_idx")
      .on(t.planId)
      .where(sql`${t.planId} is not null`),
    check("subscriptions_fee_bps_range", sql`${t.applicationFeeBps} between 0 and 10000`),
    check(
      "subscriptions_origin_values",
      sql`${t.origin} in ('created_by_cohory', 'linked_import')`,
    ),
    ownOrManagerRead("subscriptions_read", t.communityId, t.userId),
    managerWrite("subscriptions_manage", t.communityId),
    pgPolicy("subscriptions_own_rows", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
    }),
    pgPolicy("subscriptions_exit_jobs", {
      as: "permissive",
      for: "select",
      to: "public",
      using: isWebhook,
    }),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    communityId: detachedTenant(),
    ...formerCommunity(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    externalInvoiceId: text("external_invoice_id").notNull(),
    externalPaymentIntentId: text("external_payment_intent_id"),
    currency: currency(),
    amountMinor: money("amount").notNull(),
    taxMinor: money("tax").notNull().default(0),
    refundedMinor: money("refunded").notNull().default(0),
    disputeStatus: paymentDisputeStatus("dispute_status"),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("payments_external_invoice_unique").on(t.externalInvoiceId),
    index("payments_community_occurred_idx").on(t.communityId, t.occurredAt),
    index("payments_community_payment_intent_idx").on(t.communityId, t.externalPaymentIntentId),
    index("payments_subscription_id_idx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    currencyCheck("payments_currency_format", t.currency),
    check(
      "payments_amounts_valid",
      sql`${t.amountMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.refundedMinor} between 0 and ${t.amountMinor}`,
    ),
    check(
      "payments_dispute_consistent",
      sql`(${t.disputeStatus} is null) = (${t.disputedAt} is null)`,
    ),
    ...communityOrFormer("payments", t.communityId, t.formerCommunityId),
    pgPolicy("payments_manager_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
    managerWrite("payments_manage", t.communityId),
    detachSnapshotWrite("payments", t.communityId),
  ],
);

export const feeLedgerEntries = pgTable(
  "fee_ledger_entries",
  {
    id: id(),
    communityId: detachedTenant(),
    ...formerCommunity(),
    paymentId: uuid("payment_id").references(() => payments.id),
    kind: feeLedgerKind("kind").notNull(),
    reason: feeLedgerReason("reason"),
    provider: paymentProvider("provider").notNull(),
    collectionMethod: feeCollectionMethod("collection_method").notNull(),
    currency: currency(),
    baseMinor: money("base").notNull(),
    rateBps: integer("rate_bps").notNull(),
    computedFeeMinor: money("computed_fee").notNull(),
    providerFeeMinor: money("provider_fee"),
    externalRef: text("external_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("fee_ledger_entries_idempotency_unique").on(t.idempotencyKey),
    index("fee_ledger_entries_community_occurred_idx").on(t.communityId, t.occurredAt),
    index("fee_ledger_entries_payment_id_idx")
      .on(t.paymentId)
      .where(sql`${t.paymentId} is not null`),
    currencyCheck("fee_ledger_entries_currency_format", t.currency),
    check("fee_ledger_entries_rate_range", sql`${t.rateBps} between 0 and 10000`),
    ...communityOrFormer("fee_ledger_entries", t.communityId, t.formerCommunityId),
    check(
      "fee_ledger_entries_sign",
      sql`(${t.kind} = 'fee_refunded' and ${t.computedFeeMinor} <= 0 and coalesce(${t.providerFeeMinor}, 0) <= 0) or (${t.kind} in ('fee_accrued', 'fee_collected') and ${t.computedFeeMinor} >= 0 and coalesce(${t.providerFeeMinor}, 0) >= 0) or ${t.kind} in ('adjustment', 'invoice_settled')`,
    ),
    check("fee_ledger_entries_reason_kind", sql`${t.reason} is null or ${t.kind} = 'fee_refunded'`),
    pgPolicy("fee_ledger_entries_manager_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
    pgPolicy("fee_ledger_entries_append", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
    detachSnapshotWrite("fee_ledger_entries", t.communityId),
  ],
);

export const providerEvents = pgTable(
  "provider_events",
  {
    id: id(),
    provider: paymentProvider("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    externalAccountId: text("external_account_id"),
    connectionId: uuid("connection_id").references(() => paymentConnections.id, {
      onDelete: "set null",
    }),
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    livemode: boolean("livemode").notNull(),
    payloadHash: text("payload_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    unique("provider_events_provider_event_unique").on(t.provider, t.externalEventId),
    index("provider_events_community_received_idx").on(t.communityId, t.receivedAt),
    index("provider_events_connection_id_idx")
      .on(t.connectionId)
      .where(sql`${t.connectionId} is not null`),
    index("provider_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    pgPolicy("provider_events_webhook", {
      as: "permissive",
      for: "all",
      to: "public",
      using: isWebhook,
      withCheck: isWebhook,
    }),
  ],
);

export const compedMemberships = pgTable(
  "comped_memberships",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: compEndReason("end_reason"),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("comped_memberships_one_open")
      .on(t.communityId, t.userId)
      .where(sql`${t.endedAt} is null`),
    index("comped_memberships_community_created_idx").on(t.communityId, t.createdAt),
    index("comped_memberships_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.endedAt} is null and ${t.expiresAt} is not null`),
    index("comped_memberships_user_idx").on(t.userId),
    index("comped_memberships_granted_by_idx")
      .on(t.grantedBy)
      .where(sql`${t.grantedBy} is not null`),
    index("comped_memberships_ended_by_idx")
      .on(t.endedBy)
      .where(sql`${t.endedBy} is not null`),
    check(
      "comped_memberships_note_length",
      sql`char_length(${t.note}) <= ${sql.raw(String(compNoteMaxLength))}`,
    ),
    check(
      "comped_memberships_end_consistent",
      sql`(${t.endedAt} is null) = (${t.endReason} is null)`,
    ),
    ownOrManagerRead("comped_memberships_read", t.communityId, t.userId),
    managerWrite("comped_memberships_manage", t.communityId),
    pgPolicy("comped_memberships_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
    pgPolicy("comped_memberships_expiry_job", {
      as: "permissive",
      for: "all",
      to: "public",
      using: isWebhook,
      withCheck: isWebhook,
    }),
  ],
);

export const compInvitations = pgTable(
  "comp_invitations",
  {
    id: id(),
    communityId: tenant(),
    email: citext("email").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    compId: uuid("comp_id").references(() => compedMemberships.id, { onDelete: "set null" }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("comp_invitations_one_open")
      .on(t.communityId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.withdrawnAt} is null`),
    index("comp_invitations_community_created_idx").on(t.communityId, t.createdAt),
    index("comp_invitations_granted_by_idx")
      .on(t.grantedBy)
      .where(sql`${t.grantedBy} is not null`),
    index("comp_invitations_accepted_by_idx")
      .on(t.acceptedBy)
      .where(sql`${t.acceptedBy} is not null`),
    index("comp_invitations_comp_idx")
      .on(t.compId)
      .where(sql`${t.compId} is not null`),
    index("comp_invitations_withdrawn_by_idx")
      .on(t.withdrawnBy)
      .where(sql`${t.withdrawnBy} is not null`),
    check(
      "comp_invitations_note_length",
      sql`char_length(${t.note}) <= ${sql.raw(String(compNoteMaxLength))}`,
    ),
    check("comp_invitations_one_outcome", sql`${t.acceptedAt} is null or ${t.withdrawnAt} is null`),
    managerWrite("comp_invitations_manage", t.communityId),
    pgPolicy("comp_invitations_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.acceptedBy} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.acceptedBy} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export const subscriptionLinks = pgTable(
  "subscription_links",
  {
    id: id(),
    communityId: tenant(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => paymentConnections.id),
    externalSubscriptionId: text("external_subscription_id").notNull(),
    externalCustomerId: text("external_customer_id").notNull(),
    externalPriceId: text("external_price_id"),
    email: citext("email").notNull(),
    planId: uuid("plan_id").references(() => membershipPlans.id),
    interval: planInterval("interval").notNull(),
    status: subscriptionLinkStatus("status").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    applicationFeeBps: integer("application_fee_bps").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("subscription_links_external_unique").on(t.externalSubscriptionId),
    index("subscription_links_community_created_idx").on(t.communityId, t.createdAt),
    index("subscription_links_community_invited_email_idx")
      .on(t.communityId, t.email)
      .where(sql`${t.status} = 'invited'`),
    index("subscription_links_connection_idx").on(t.connectionId),
    index("subscription_links_plan_idx")
      .on(t.planId)
      .where(sql`${t.planId} is not null`),
    index("subscription_links_user_idx")
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    index("subscription_links_subscription_idx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    index("subscription_links_created_by_idx")
      .on(t.createdBy)
      .where(sql`${t.createdBy} is not null`),
    check("subscription_links_fee_bps_range", sql`${t.applicationFeeBps} between 0 and 10000`),
    check(
      "subscription_links_linked_at",
      sql`(${t.status} = 'linked') = (${t.linkedAt} is not null)`,
    ),
    managerWrite("subscription_links_manage", t.communityId),
  ],
);

export const paymentExitRuns = pgTable(
  "payment_exit_runs",
  {
    id: id(),
    communityId: tenant(),
    connectionId: uuid("connection_id").references(() => paymentConnections.id),
    kind: paymentExitKind("kind").notNull(),
    choice: paymentExitChoice("choice").notNull(),
    includeLinked: boolean("include_linked").notNull().default(true),
    status: paymentExitStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    targetCount: integer("target_count").notNull().default(0),
    doneCount: integer("done_count").notNull().default(0),
    failedSubscriptionIds: text("failed_subscription_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    portalLoginUrl: text("portal_login_url"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    manualCancellationConfirmedAt: timestamp("manual_cancellation_confirmed_at", {
      withTimezone: true,
    }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("payment_exit_runs_community_created_idx").on(t.communityId, t.createdAt),
    uniqueIndex("payment_exit_runs_one_unfinished")
      .on(t.communityId)
      .where(sql`${t.status} in ('pending', 'running')`),
    index("payment_exit_runs_connection_idx")
      .on(t.connectionId)
      .where(sql`${t.connectionId} is not null`),
    index("payment_exit_runs_requested_by_idx")
      .on(t.requestedBy)
      .where(sql`${t.requestedBy} is not null`),
    check(
      "payment_exit_runs_counts",
      sql`${t.attempts} >= 0 and ${t.targetCount} >= 0 and ${t.doneCount} >= 0`,
    ),
    pgPolicy("payment_exit_runs_manager_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
    managerWrite("payment_exit_runs_manage", t.communityId),
    pgPolicy("payment_exit_runs_job", {
      as: "permissive",
      for: "all",
      to: "public",
      using: isWebhook,
      withCheck: isWebhook,
    }),
  ],
);
