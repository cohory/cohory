import type { MembershipPriceView, YearlySwitchView } from "./service/member-billing";
import type {
  PaymentConnectionStatus,
  PaymentProvider,
  PlanInterval,
  SubscriptionAccessState,
} from "@cohory/db/schema";

import type { MembershipAccess } from "./access";
import type { ExitChoice, ExitKind, ExitRunRecord, ExitRunStatus } from "./exit/store";
import type { Edition } from "./fee";
import { capabilityRecord } from "./providers/capabilities";
import type {
  ConnectionRecord,
  CurrencyTotals,
  PlanRecord,
  SubscriptionListRow,
  SubscriptionRecord,
} from "./repository";

export interface ConnectionView {
  readonly id: string;
  readonly provider: PaymentProvider;
  readonly status: PaymentConnectionStatus;
  readonly externalAccountId: string | null;
  readonly chargesEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly livemode: boolean;
  readonly webhookPath: string | null;
  readonly providerName: string;
  readonly feeSplit: boolean;
  readonly customerPortal: boolean;
  readonly webhookSecretSaved: boolean;
  readonly lastWebhookAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MembershipProviderView {
  readonly id: PaymentProvider;
  readonly name: string;
  readonly customerPortal: boolean;
}

export interface PaymentsOverview {
  readonly edition: Edition;
  readonly platformFeeBps: number;
  readonly providers: readonly PaymentProvider[];
  readonly connection: ConnectionView | null;
  readonly polarRetired: boolean;
}

export interface PlanView {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly monthlyPriceMinor: number;
  readonly annualPriceMinor: number | null;
  readonly purchasable: boolean;
  readonly providerName: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export interface SubscriptionView {
  readonly id: string;
  readonly providerStatus: string;
  readonly accessState: SubscriptionAccessState;
  readonly interval: PlanInterval | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly endedAt: Date | null;
  readonly linked: boolean;
  readonly createdAt: Date;
}

export interface SubscriptionListItem extends SubscriptionView {
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly dashboardUrl: string | null;
}

export interface MyMembershipView {
  readonly access: MembershipAccess;
  readonly plan: PlanView | null;
  readonly subscription: SubscriptionView | null;
  readonly canManageBilling: boolean;
  readonly resubscribe: { readonly endsAt: Date } | null;
  readonly provider: MembershipProviderView | null;
  readonly communityArchived: boolean;
  readonly canRejoin: boolean;
  readonly inviteRequired: boolean;
  readonly asksJoinQuestions: boolean;
  readonly supportContact: string | null;
  readonly price: MembershipPriceView | null;
  readonly yearly: YearlySwitchView | null;
  readonly suggestYearly: boolean;
  readonly paused: boolean;
}

export interface LedgerCurrencySummary extends CurrencyTotals {
  readonly netPlatformFeeMinor: number;
}

export interface LedgerSummary {
  readonly edition: Edition;
  readonly platformFeeBps: number;
  readonly currencies: readonly LedgerCurrencySummary[];
}

export interface RedirectView {
  readonly url: string;
}

export function ownKeysWebhookPath(connectionId: string): string {
  return `/api/webhooks/stripe/own/${connectionId}`;
}

export function providerWebhookPath(connectionId: string): string {
  return `/api/webhooks/payments/${connectionId}`;
}

function webhookPathOf(connection: ConnectionRecord): string | null {
  switch (capabilityRecord(connection.provider)?.setup) {
    case "platform_account":
      return null;
    case "own_keys":
      return ownKeysWebhookPath(connection.id);
    default:
      return providerWebhookPath(connection.id);
  }
}

export function providerView(provider: PaymentProvider): MembershipProviderView {
  const record = capabilityRecord(provider);
  return {
    id: provider,
    name: record?.displayName ?? provider,
    customerPortal: record?.capabilities.supportsCustomerPortal ?? false,
  };
}

export function toConnectionView(connection: ConnectionRecord): ConnectionView {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    externalAccountId: connection.externalAccountId,
    chargesEnabled: connection.chargesEnabled,
    detailsSubmitted: connection.detailsSubmitted,
    livemode: connection.livemode,
    webhookPath: webhookPathOf(connection),
    providerName: capabilityRecord(connection.provider)?.displayName ?? connection.provider,
    feeSplit: capabilityRecord(connection.provider)?.capabilities.supportsFeeSplit ?? false,
    customerPortal:
      capabilityRecord(connection.provider)?.capabilities.supportsCustomerPortal ?? false,
    webhookSecretSaved: connection.webhookSecretEncrypted !== null,
    lastWebhookAt: connection.lastWebhookAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export function awaitsOwnerReview(
  connection: Pick<ConnectionRecord, "acceptedOwnerId">,
  ownerId: string | null,
): boolean {
  return ownerId === null || connection.acceptedOwnerId !== ownerId;
}

export function isPurchasable(
  plan: PlanRecord,
  connection: ConnectionRecord | null,
  ownerId: string | null,
): boolean {
  return (
    plan.archivedAt === null &&
    plan.providerMonthlyPriceId !== null &&
    connection !== null &&
    connection.id === plan.connectionId &&
    connection.status === "active" &&
    connection.chargesEnabled &&
    !awaitsOwnerReview(connection, ownerId)
  );
}

export function toPlanView(
  plan: PlanRecord,
  connection: ConnectionRecord | null,
  ownerId: string | null,
): PlanView {
  return {
    id: plan.id,
    name: plan.name,
    currency: plan.currency,
    monthlyPriceMinor: plan.monthlyPriceMinor,
    annualPriceMinor: plan.providerAnnualPriceId ? plan.annualPriceMinor : null,
    purchasable: isPurchasable(plan, connection, ownerId),
    providerName:
      connection && connection.id === plan.connectionId
        ? providerView(connection.provider).name
        : null,
    archivedAt: plan.archivedAt,
    createdAt: plan.createdAt,
  };
}

export function toDraftPlanView(plan: PlanRecord): PlanView {
  return { ...toPlanView(plan, null, null), annualPriceMinor: plan.annualPriceMinor };
}

export function toSubscriptionView(subscription: SubscriptionRecord): SubscriptionView {
  return {
    id: subscription.id,
    providerStatus: subscription.providerStatus,
    accessState: subscription.accessState,
    interval: subscription.interval,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    endedAt: subscription.endedAt,
    linked: subscription.origin === "linked_import",
    createdAt: subscription.createdAt,
  };
}

function subscriptionAmount(row: SubscriptionListRow): number | null {
  if (!row.plan) return null;
  return row.subscription.interval === "year"
    ? row.plan.annualPriceMinor
    : row.plan.monthlyPriceMinor;
}

function dashboardUrl(row: SubscriptionListRow): string | null {
  const connection = row.connection;
  const url = connection ? capabilityRecord(connection.provider)?.subscriptionDashboardUrl : null;
  if (!connection || !url) return null;
  return url({
    accountId: connection.externalAccountId,
    livemode: connection.livemode,
    subscriptionId: row.subscription.externalSubscriptionId,
  });
}

export function toSubscriptionListItem(row: SubscriptionListRow): SubscriptionListItem {
  const amountMinor = subscriptionAmount(row);
  return {
    ...toSubscriptionView(row.subscription),
    userId: row.subscription.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    amountMinor,
    currency: amountMinor === null ? null : (row.plan?.currency ?? null),
    dashboardUrl: dashboardUrl(row),
  };
}

export function toLedgerCurrencySummary(totals: CurrencyTotals): LedgerCurrencySummary {
  return {
    ...totals,
    netPlatformFeeMinor: totals.platformFeeMinor - totals.platformFeeRefundedMinor,
  };
}

export interface ExitRunMember {
  readonly userId: string;
  readonly name: string;
}

export interface ExitRunView {
  readonly id: string;
  readonly kind: ExitKind;
  readonly choice: ExitChoice;
  readonly status: ExitRunStatus;
  readonly includeLinked: boolean;
  readonly targetCount: number;
  readonly doneCount: number;
  readonly failedCount: number;
  readonly failedMembers: readonly ExitRunMember[];
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

export type PaidMembersConnection = "none" | "open" | "disconnecting" | "closed";

export interface PaidMembersSummary {
  readonly connection: PaidMembersConnection;
  readonly cohory: number;
  readonly linkedImports: number;
  readonly endingAtPeriodEnd: number;
  readonly manualCancellation: number;
  readonly run: ExitRunView | null;
}

export function toExitRunView(
  run: ExitRunRecord,
  failedMembers: readonly ExitRunMember[],
): ExitRunView {
  return {
    id: run.id,
    kind: run.kind,
    choice: run.choice,
    status: run.status,
    includeLinked: run.includeLinked,
    targetCount: run.targetCount,
    doneCount: run.doneCount,
    failedCount: run.failedSubscriptionIds.length,
    failedMembers,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}
