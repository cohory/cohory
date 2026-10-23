import type { ConnectionSetup, ProviderCapabilities, ProviderId } from "./types";

export interface DashboardSubscription {
  readonly accountId: string | null;
  readonly livemode: boolean;
  readonly subscriptionId: string;
}

export interface CapabilityRecord {
  readonly provider: ProviderId;
  readonly displayName: string;
  readonly setup: ConnectionSetup;
  readonly subscriptionDashboardUrl: ((subscription: DashboardSubscription) => string) | null;
  readonly capabilities: ProviderCapabilities;
  readonly reviewedOn: string;
  readonly sources: readonly string[];
}

function stripeSubscriptionUrl(subscription: DashboardSubscription): string {
  const account = subscription.accountId ? `${subscription.accountId}/` : "";
  const mode = subscription.livemode ? "" : "test/";
  return `https://dashboard.stripe.com/${account}${mode}subscriptions/${encodeURIComponent(subscription.subscriptionId)}`;
}

export const stripeConnectCapabilities: CapabilityRecord = {
  provider: "stripe_connect",
  displayName: "Stripe",
  setup: "platform_account",
  subscriptionDashboardUrl: stripeSubscriptionUrl,
  reviewedOn: "2026-10-19",
  sources: [
    "https://docs.stripe.com/connect/direct-charges",
    "https://docs.stripe.com/connect/subscriptions",
    "https://docs.stripe.com/customer-management",
  ],
  capabilities: {
    supportsFeeSplit: true,
    supportsSubscriptions: true,
    supportsSubscriptionImport: true,
    supportsHostedCheckout: true,
    supportsCustomerPortal: true,
    supportsRefundApi: true,
    emitsDisputeEvents: true,
    currencies: "any",
  },
};

export const stripeOwnKeysCapabilities: CapabilityRecord = {
  provider: "stripe_own_keys",
  displayName: "Stripe",
  setup: "own_keys",
  subscriptionDashboardUrl: stripeSubscriptionUrl,
  reviewedOn: "2026-10-19",
  sources: ["https://docs.stripe.com/keys", "https://docs.stripe.com/webhooks"],
  capabilities: {
    ...stripeConnectCapabilities.capabilities,
    supportsFeeSplit: false,
  },
};

export const polarCapabilities: CapabilityRecord = {
  provider: "polar",
  displayName: "Polar",
  setup: "access_token",
  subscriptionDashboardUrl: null,
  reviewedOn: "2026-10-19",
  sources: [
    "https://polar.sh/docs/integrate/sandbox",
    "https://polar.sh/docs/integrate/webhooks/delivery",
    "https://polar.sh/docs/api-reference/checkouts/create-session",
    "https://polar.sh/docs/api-reference/subscriptions/update",
    "https://polar.sh/docs/api-reference/refunds/create",
    "https://polar.sh/docs/api-reference/customer-portal/sessions/create",
    "https://polar.sh/docs/api-reference/products/create",
    "https://polar.sh/docs/openapi/2026-10.openapi.json",
  ],
  capabilities: {
    supportsFeeSplit: false,
    supportsSubscriptions: true,
    supportsSubscriptionImport: false,
    supportsHostedCheckout: true,
    supportsCustomerPortal: true,
    supportsRefundApi: true,
    emitsDisputeEvents: false,
    currencies: "any",
  },
};

const records = new Map<ProviderId, CapabilityRecord>([
  ["stripe_connect", stripeConnectCapabilities],
  ["stripe_own_keys", stripeOwnKeysCapabilities],
  ["polar", polarCapabilities],
]);

export function capabilityRecord(provider: ProviderId): CapabilityRecord | null {
  return records.get(provider) ?? null;
}

export interface ProviderFlags {
  readonly polarEnabled: boolean;
}

export function isProviderEnabled(provider: ProviderId, flags: ProviderFlags): boolean {
  return provider !== "polar" || flags.polarEnabled;
}

export function capabilityRecords(flags: ProviderFlags): readonly CapabilityRecord[] {
  return [...records.values()].filter((record) => isProviderEnabled(record.provider, flags));
}
