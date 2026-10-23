import type {
  ConnectionView,
  MembershipPriceView,
  MyMembershipView,
  PlanView,
  SubscriptionListItem,
} from "@cohory/payments";
import type { BillingInterval, SubscriptionRow } from "@cohory/ui";

export interface YearlySuggestion {
  readonly annualPriceMinor: number;
  readonly savingMinor: number;
  readonly currency: string;
}

export type MembershipPageState =
  | { readonly kind: "staff" }
  | { readonly kind: "banned" }
  | { readonly kind: "free_member" }
  | { readonly kind: "free_community" }
  | {
      readonly kind: "subscribed";
      readonly status: "active" | "past_due" | "canceling" | "paused";
      readonly interval: BillingInterval | null;
      readonly periodEnd: Date | null;
      readonly canManageBilling: boolean;
      readonly price: MembershipPriceView | null;
      readonly canCancel: boolean;
      readonly yearlySuggestion: YearlySuggestion | null;
    }
  | { readonly kind: "invite_only" }
  | { readonly kind: "buy"; readonly purchasable: boolean; readonly canManageBilling: boolean };

function buyOrFree(plan: PlanView | null, canManageBilling: boolean): MembershipPageState {
  return plan
    ? { kind: "buy", purchasable: plan.purchasable, canManageBilling }
    : { kind: "free_community" };
}

type SubscriptionAccess = Extract<
  MyMembershipView["access"],
  { level: "member"; source: "subscription" }
>;

function subscribedStatus(
  access: SubscriptionAccess,
  paused: boolean,
): Extract<MembershipPageState, { kind: "subscribed" }>["status"] {
  if (access.state === "grace") return "past_due";
  if (access.cancelAtPeriodEnd) return "canceling";
  return paused ? "paused" : "active";
}

export function membershipPageState(
  plan: PlanView | null,
  mine: MyMembershipView | null,
  visitor: { readonly inviteOnly: boolean } = { inviteOnly: false },
): MembershipPageState {
  if (!mine) {
    return plan && visitor.inviteOnly ? { kind: "invite_only" } : buyOrFree(plan, false);
  }
  const { access } = mine;
  switch (access.level) {
    case "staff":
      return { kind: "staff" };
    case "banned":
      return { kind: "banned" };
    case "member":
      if (access.source === "membership" || access.source === "comp") {
        return { kind: "free_member" };
      }
      return {
        kind: "subscribed",
        status: subscribedStatus(access, mine.paused),
        interval: mine.subscription?.interval ?? null,
        periodEnd: access.currentPeriodEnd,
        canManageBilling: mine.canManageBilling,
        price: mine.price,
        canCancel:
          mine.canManageBilling && !mine.paused && !access.cancelAtPeriodEnd && mine.price !== null,
        yearlySuggestion: mine.suggestYearly ? mine.yearly : null,
      };
    case "payment_required":
    case "not_member":
      return plan && mine.inviteRequired
        ? { kind: "invite_only" }
        : buyOrFree(plan, mine.canManageBilling);
  }
}

export function billingClosedNotice(
  communityName: string,
  mine: MyMembershipView | null,
): string | null {
  if (mine?.access.level !== "payment_required" || mine.access.reason !== "billing_closed") {
    return null;
  }
  const ended = `Your paid access to ${communityName} ended. Join again from the community page`;
  return mine.supportContact ? `${ended}, or contact ${mine.supportContact}.` : `${ended}.`;
}

export function pausedReturn(value: string | string[] | undefined): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type CheckoutReturn = "success" | "cancel" | null;

export function checkoutReturn(value: string | string[] | undefined): CheckoutReturn {
  return value === "success" || value === "cancel" ? value : null;
}

export type StripeReturn = "return" | "refresh" | null;

export function connectSetupRequested(
  setup: string | string[] | undefined,
  connection: object | null,
): boolean {
  return setup === "connect" && connection === null;
}

export function stripeReturn(value: string | string[] | undefined): StripeReturn {
  return value === "return" || value === "refresh" ? value : null;
}

export function toSubscriptionRow(item: SubscriptionListItem): SubscriptionRow {
  return {
    id: item.id,
    memberName: item.userName,
    memberEmail: item.userEmail,
    providerStatus: item.providerStatus,
    interval: item.interval,
    currentPeriodEnd: item.currentPeriodEnd,
    cancelAtPeriodEnd: item.cancelAtPeriodEnd,
    endedAt: item.endedAt,
    amountMinor: item.amountMinor,
    currency: item.currency,
    dashboardUrl: item.dashboardUrl,
  };
}

export function connectionReady(connection: ConnectionView | null): boolean {
  return connection?.status === "active" && connection.chargesEnabled;
}

export function webhookUrl(connection: ConnectionView, appUrl: string): string | null {
  return connection.webhookPath ? `${appUrl.replace(/\/$/, "")}${connection.webhookPath}` : null;
}

export function membershipHref(slug: string): string {
  return `/c/${slug}/membership`;
}
