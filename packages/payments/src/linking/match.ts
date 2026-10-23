import type { CommunityRole } from "@cohory/authz";
import type { MemberStatus, PlanInterval } from "@cohory/db/schema";

import type { GatewaySubscriptionSummary } from "../gateway";
import { normalizeEmail, type SubscriberBlock } from "./views";

export const linkActions = ["link_member", "link_and_add", "invite", "skip"] as const;

export type LinkAction = (typeof linkActions)[number];

export interface MatchCandidate {
  readonly userId: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly membership: { readonly role: CommunityRole; readonly status: MemberStatus } | null;
}

export interface PlanPrices {
  readonly monthlyPriceId: string | null;
  readonly annualPriceId: string | null;
}

export interface MatchContext {
  readonly communityId: string;
  readonly usersByEmail: ReadonlyMap<string, MatchCandidate>;
  readonly mirrored: ReadonlySet<string>;
  readonly invited: ReadonlySet<string>;
  readonly customerOwners: ReadonlyMap<string, string>;
  readonly bannedEmails: ReadonlySet<string>;
  readonly ownApplicationId: string | null;
  readonly matchOutsiders: boolean;
  readonly plan: PlanPrices | null;
}

export type SubscriberMatch =
  | { readonly kind: "member"; readonly userId: string; readonly name: string }
  | { readonly kind: "user"; readonly userId: string; readonly name: string }
  | { readonly kind: "unverified" }
  | { readonly kind: "none" };

export interface SubscriberPreview {
  readonly email: string | null;
  readonly match: SubscriberMatch;
  readonly block: SubscriberBlock | null;
  readonly proposed: LinkAction;
  readonly allowed: readonly LinkAction[];
  readonly suggestedInterval: PlanInterval | null;
}

export function suggestInterval(
  summary: GatewaySubscriptionSummary,
  plan: PlanPrices | null,
): PlanInterval | null {
  if (plan && summary.priceId) {
    if (summary.priceId === plan.monthlyPriceId) {
      return "month";
    }
    if (summary.priceId === plan.annualPriceId) {
      return "year";
    }
  }
  if (summary.intervalCount !== 1) {
    return null;
  }
  return summary.interval === "month" || summary.interval === "year" ? summary.interval : null;
}

function visible(
  candidate: MatchCandidate | undefined,
  matchOutsiders: boolean,
): MatchCandidate | undefined {
  if (matchOutsiders || !candidate) {
    return candidate;
  }
  const status = candidate.membership?.status;
  return status === "active" || status === "banned" ? candidate : undefined;
}

function matchOf(candidate: MatchCandidate | undefined): SubscriberMatch {
  if (!candidate) {
    return { kind: "none" };
  }
  if (!candidate.emailVerified) {
    return { kind: "unverified" };
  }
  return candidate.membership?.status === "active"
    ? { kind: "member", userId: candidate.userId, name: candidate.name }
    : { kind: "user", userId: candidate.userId, name: candidate.name };
}

function blockOf(
  summary: GatewaySubscriptionSummary,
  email: string | null,
  candidate: MatchCandidate | undefined,
  match: SubscriberMatch,
  context: MatchContext,
): SubscriberBlock | null {
  if (
    context.mirrored.has(summary.id) ||
    summary.metadata["cohory_community_id"] === context.communityId
  ) {
    return "already_linked";
  }
  if (context.invited.has(summary.id)) {
    return "invited";
  }
  if (summary.createdByApplication && summary.createdByApplication !== context.ownApplicationId) {
    return "other_platform";
  }
  if (!email) {
    return "no_email";
  }
  if (candidate?.membership?.status === "banned" || context.bannedEmails.has(email)) {
    return "banned";
  }
  const owner = context.customerOwners.get(summary.customerId);
  const matchedUser = match.kind === "member" || match.kind === "user" ? match.userId : null;
  if (owner !== undefined && owner !== matchedUser) {
    return "customer_conflict";
  }
  return null;
}

function allowedFor(match: SubscriberMatch): readonly LinkAction[] {
  switch (match.kind) {
    case "member":
      return ["link_member", "skip"];
    case "user":
      return ["link_and_add", "skip"];
    case "unverified":
    case "none":
      return ["invite", "skip"];
  }
}

export function previewSubscriber(
  summary: GatewaySubscriptionSummary,
  context: MatchContext,
): SubscriberPreview {
  const email = normalizeEmail(summary.customerEmail);
  const candidate = visible(
    email ? context.usersByEmail.get(email) : undefined,
    context.matchOutsiders,
  );
  const match = matchOf(candidate);
  const block = blockOf(summary, email, candidate, match, context);
  const allowed = block ? (["skip"] as const) : allowedFor(match);
  return {
    email,
    match,
    block,
    proposed: allowed[0] ?? "skip",
    allowed,
    suggestedInterval: suggestInterval(summary, context.plan),
  };
}
