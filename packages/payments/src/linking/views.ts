import type { PlanInterval } from "@cohory/db/schema";

import type { Edition } from "../fee";
import type { GatewaySubscriptionSummary } from "../gateway";
import type { LinkAction, SubscriberMatch, SubscriberPreview } from "./match";

export type SubscriberBlock =
  "already_linked" | "invited" | "other_platform" | "no_email" | "banned" | "customer_conflict";

export interface DiscoveredSubscriber {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly email: string | null;
  readonly customerName: string | null;
  readonly status: string;
  readonly priceId: string | null;
  readonly unitAmountMinor: number | null;
  readonly currency: string;
  readonly interval: string | null;
  readonly intervalCount: number;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly match: SubscriberMatch;
  readonly block: SubscriberBlock | null;
  readonly proposed: LinkAction;
  readonly allowed: readonly LinkAction[];
  readonly suggestedInterval: PlanInterval | null;
}

export interface DiscoveryPlan {
  readonly name: string;
  readonly currency: string;
  readonly monthlyPriceMinor: number;
  readonly annualPriceMinor: number | null;
}

export interface SubscriberDiscovery {
  readonly rows: readonly DiscoveredSubscriber[];
  readonly nextCursor: string | null;
  readonly plan: DiscoveryPlan | null;
  readonly edition: Edition;
  readonly platformFeeBps: number;
  readonly canAddPlatformFee: boolean;
}

export function normalizeEmail(email: string | null): string | null {
  const trimmed = email?.trim().toLowerCase() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function toDiscoveredSubscriber(
  summary: GatewaySubscriptionSummary,
  preview: SubscriberPreview,
): DiscoveredSubscriber {
  return {
    subscriptionId: summary.id,
    customerId: summary.customerId,
    email: preview.email,
    customerName: summary.customerName,
    status: summary.status,
    priceId: summary.priceId,
    unitAmountMinor: summary.unitAmountMinor,
    currency: summary.currency,
    interval: summary.interval,
    intervalCount: summary.intervalCount,
    currentPeriodEnd: summary.currentPeriodEnd,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    match: preview.match,
    block: preview.block,
    proposed: preview.proposed,
    allowed: preview.allowed,
    suggestedInterval: preview.suggestedInterval,
  };
}

export type LinkOutcome = "linked" | "added" | "invited" | "skipped" | "already_linked" | "refused";

export type LinkRefusal = SubscriberBlock | "not_found" | "status" | "match_changed";

export interface LinkRowResult {
  readonly subscriptionId: string;
  readonly email: string | null;
  readonly outcome: LinkOutcome;
  readonly reason: LinkRefusal | null;
  readonly platformFeeAdded: boolean;
}

export interface LinkResult {
  readonly rows: readonly LinkRowResult[];
  readonly invitedEmails: readonly string[];
}

export interface ClaimResult {
  readonly claimed: number;
  readonly waitingForVerification: boolean;
}

export interface SubscriptionLinkView {
  readonly id: string;
  readonly externalSubscriptionId: string;
  readonly email: string;
  readonly status: "linked" | "invited";
  readonly interval: PlanInterval;
  readonly platformFeeBps: number;
  readonly linkedAt: Date | null;
  readonly createdAt: Date;
}
