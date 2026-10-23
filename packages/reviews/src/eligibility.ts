export const reviewTenureDays = 30;

const dayMs = 24 * 60 * 60 * 1000;

export interface TenureFacts {
  readonly providerStatus: string;
  readonly accessState: "none" | "granted" | "grace" | "revoked";
  readonly interval: "month" | "year" | null;
  readonly paidSince: Date;
}

export interface EligibilityInput {
  readonly membershipActive: boolean;
  readonly tenure: TenureFacts | null;
  readonly now: Date;
}

export type IneligibleReason =
  | "not_member"
  | "no_subscription"
  | "one_time"
  | "trialing"
  | "past_due"
  | "not_active"
  | "too_soon";

export type Eligibility =
  | { readonly eligible: true; readonly payingSince: Date }
  | {
      readonly eligible: false;
      readonly reason: IneligibleReason;
      readonly eligibleFrom: Date | null;
    };

function ineligible(reason: IneligibleReason, eligibleFrom: Date | null = null): Eligibility {
  return { eligible: false, reason, eligibleFrom };
}

export function eligibleFrom(paidSince: Date): Date {
  return new Date(paidSince.getTime() + reviewTenureDays * dayMs);
}

export function isPaying(tenure: TenureFacts | null): tenure is TenureFacts {
  return (
    tenure !== null &&
    tenure.interval !== null &&
    tenure.providerStatus === "active" &&
    tenure.accessState === "granted"
  );
}

export function reviewEligibility({
  membershipActive,
  tenure,
  now,
}: EligibilityInput): Eligibility {
  if (!membershipActive) {
    return ineligible("not_member");
  }
  if (!tenure) {
    return ineligible("no_subscription");
  }
  if (tenure.interval === null) {
    return ineligible("one_time");
  }
  if (tenure.providerStatus === "trialing") {
    return ineligible("trialing");
  }
  if (tenure.providerStatus === "past_due") {
    return ineligible("past_due");
  }
  if (!isPaying(tenure)) {
    return ineligible("not_active");
  }
  const from = eligibleFrom(tenure.paidSince);
  if (from.getTime() > now.getTime()) {
    return ineligible("too_soon", from);
  }
  return { eligible: true, payingSince: tenure.paidSince };
}

export function payingMonths(paidSince: Date, now: Date): number {
  let months =
    (now.getUTCFullYear() - paidSince.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - paidSince.getUTCMonth());
  if (now.getUTCDate() < paidSince.getUTCDate()) {
    months -= 1;
  }
  return Math.max(1, months);
}

export type ReviewerStatus =
  { readonly kind: "paying"; readonly months: number } | { readonly kind: "former" };

export function reviewerStatus(tenure: TenureFacts | null, now: Date): ReviewerStatus {
  const active =
    tenure !== null &&
    tenure.interval !== null &&
    tenure.providerStatus !== "trialing" &&
    (tenure.accessState === "granted" || tenure.accessState === "grace");
  return active
    ? { kind: "paying", months: payingMonths(tenure.paidSince, now) }
    : { kind: "former" };
}

export function reviewerStatusLabel(status: ReviewerStatus): string {
  if (status.kind === "former") {
    return "Former member";
  }
  return `Paying member for ${status.months} ${status.months === 1 ? "month" : "months"}`;
}

export const eligibilityRuleText = "Members who have paid for at least 30 days can leave a review.";

export function eligibilityMessage(eligibility: Eligibility): string | null {
  if (eligibility.eligible) {
    return null;
  }
  if (eligibility.reason === "past_due") {
    return `${eligibilityRuleText} Update your payment details to leave one.`;
  }
  if (eligibility.reason === "too_soon" && eligibility.eligibleFrom) {
    const date = eligibility.eligibleFrom.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${eligibilityRuleText} You can leave one from ${date}.`;
  }
  return eligibilityRuleText;
}
