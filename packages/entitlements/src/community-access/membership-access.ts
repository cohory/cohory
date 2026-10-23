import type {
  MemberRemovalReason,
  MemberRole,
  MemberStatus,
  SubscriptionAccessState,
} from "@cohory/db/schema";

export type { SubscriptionAccessState };

const statusAccess: Readonly<Record<string, SubscriptionAccessState>> = {
  incomplete: "none",
  incomplete_expired: "none",
  trialing: "granted",
  active: "granted",
  past_due: "grace",
  unpaid: "revoked",
  canceled: "revoked",
  paused: "revoked",
};

export function accessStateFor(
  providerStatus: string,
  currentPeriodEnd: Date | null = null,
  now: Date | null = null,
): SubscriptionAccessState {
  if (providerStatus === "paused" && currentPeriodEnd && now && currentPeriodEnd > now) {
    return "granted";
  }
  return statusAccess[providerStatus] ?? "none";
}

export function grants(state: SubscriptionAccessState | null): boolean {
  return state === "granted" || state === "grace";
}

export interface MembershipSnapshot {
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly removalReason?: MemberRemovalReason | null;
}

export interface SubscriptionSnapshot {
  readonly providerStatus: string;
  readonly accessState: SubscriptionAccessState;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly connectionClosedAt?: Date | null;
}

export interface CompSnapshot {
  readonly expiresAt: Date | null;
}

export interface AccessInput {
  readonly paidPlanActive: boolean;
  readonly membership: MembershipSnapshot | null;
  readonly subscription: SubscriptionSnapshot | null;
  readonly comp: CompSnapshot | null;
  readonly now: Date;
}

export type MembershipAccess =
  | { readonly level: "banned" }
  | { readonly level: "staff"; readonly role: MemberRole }
  | {
      readonly level: "member";
      readonly source: "subscription";
      readonly state: "granted" | "grace";
      readonly currentPeriodEnd: Date | null;
      readonly cancelAtPeriodEnd: boolean;
    }
  | { readonly level: "member"; readonly source: "comp"; readonly expiresAt: Date | null }
  | { readonly level: "member"; readonly source: "membership" }
  | {
      readonly level: "payment_required";
      readonly reason: "no_subscription" | "incomplete" | "ended" | "billing_closed";
    }
  | { readonly level: "not_member" };

export type AccessLevel = MembershipAccess["level"];

export function accessEndAfterClose(
  subscription: Pick<SubscriptionSnapshot, "accessState" | "currentPeriodEnd">,
  closedAt: Date,
): Date | null {
  if (!grants(subscription.accessState)) {
    return null;
  }
  const periodEnd = subscription.currentPeriodEnd;
  return periodEnd && periodEnd > closedAt ? periodEnd : closedAt;
}

function closedBillingEnded(subscription: SubscriptionSnapshot, now: Date): boolean {
  const closedAt = subscription.connectionClosedAt;
  if (!closedAt) {
    return false;
  }
  const end = accessEndAfterClose(subscription, closedAt);
  return end ? end <= now : grants(accessStateFor(subscription.providerStatus));
}

function subscriptionGrants(subscription: SubscriptionSnapshot, now: Date): boolean {
  if (!grants(subscription.accessState)) {
    return false;
  }
  if (subscription.connectionClosedAt) {
    const end = accessEndAfterClose(subscription, subscription.connectionClosedAt);
    return end !== null && end > now;
  }
  if (subscription.providerStatus === "paused") {
    return subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd > now;
  }
  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
    return subscription.currentPeriodEnd > now;
  }
  return true;
}

export function compGrants(comp: CompSnapshot | null, now: Date): boolean {
  return comp !== null && (comp.expiresAt === null || comp.expiresAt > now);
}

export function resolveMembershipAccess(input: AccessInput): MembershipAccess {
  const { membership, subscription, comp } = input;
  if (membership?.status === "banned") {
    return { level: "banned" };
  }
  if (membership?.status === "active" && membership.role !== "member") {
    return { level: "staff", role: membership.role };
  }
  if (subscription && subscriptionGrants(subscription, input.now)) {
    return {
      level: "member",
      source: "subscription",
      state: subscription.accessState === "grace" ? "grace" : "granted",
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }
  if (comp && compGrants(comp, input.now)) {
    return { level: "member", source: "comp", expiresAt: comp.expiresAt };
  }
  if (subscription && closedBillingEnded(subscription, input.now)) {
    return { level: "payment_required", reason: "billing_closed" };
  }
  if (membership?.status === "active") {
    return { level: "member", source: "membership" };
  }
  if (!input.paidPlanActive) {
    return { level: "not_member" };
  }
  if (!subscription) {
    return { level: "payment_required", reason: "no_subscription" };
  }
  return {
    level: "payment_required",
    reason: subscription.accessState === "none" ? "incomplete" : "ended",
  };
}

export function hasAccess(access: MembershipAccess): boolean {
  return access.level === "staff" || access.level === "member";
}
