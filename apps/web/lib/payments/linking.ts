import type {
  DiscoveredSubscriber,
  LinkRefusal,
  LinkResult,
  SubscriberMatch,
} from "@cohory/payments";
import type { SubscriberLinkChoice, SubscriberLinkMatch, SubscriberLinkRow } from "@cohory/ui";

export function subscribersHref(slug: string): string {
  return `/c/${slug}/manage/migration/subscribers`;
}

function matchView(match: SubscriberMatch): SubscriberLinkMatch {
  switch (match.kind) {
    case "member":
    case "user":
      return { kind: match.kind, name: match.name };
    case "unverified":
    case "none":
      return { kind: match.kind };
  }
}

export function toLinkRow(row: DiscoveredSubscriber): SubscriberLinkRow {
  return {
    id: row.subscriptionId,
    email: row.email,
    customerName: row.customerName,
    status: row.status,
    unitAmountMinor: row.unitAmountMinor,
    currency: row.currency,
    interval: row.interval,
    intervalCount: row.intervalCount,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    match: matchView(row.match),
    block: row.block,
    allowed: row.allowed,
  };
}

export function initialChoices(
  rows: readonly DiscoveredSubscriber[],
): Record<string, SubscriberLinkChoice> {
  return Object.fromEntries(
    rows
      .filter((row) => row.block === null)
      .map((row) => [
        row.subscriptionId,
        { action: row.proposed, interval: row.suggestedInterval },
      ]),
  );
}

export interface LinkSummary {
  readonly linked: number;
  readonly invited: number;
  readonly skipped: number;
  readonly problems: readonly { readonly label: string; readonly message: string }[];
  readonly emailsSent: number;
}

const refusalMessages: Readonly<Record<LinkRefusal, string>> = {
  already_linked: "Already linked.",
  invited: "Already invited.",
  other_platform: "Another platform created this subscription, so it can't be linked.",
  no_email: "The Stripe customer has no email address.",
  banned: "This person is banned from the community.",
  customer_conflict: "This Stripe customer already belongs to another member.",
  not_found: "Stripe no longer has this subscription.",
  status: "The subscription is no longer active in Stripe.",
  match_changed: "The match changed since you loaded the page. Review it again.",
};

export function refusalMessage(reason: LinkRefusal | null): string {
  return reason ? refusalMessages[reason] : "Stripe couldn't complete this one.";
}

export function summarizeLinkResult(result: LinkResult, emailsSent: number): LinkSummary {
  const count = (...outcomes: string[]) =>
    result.rows.filter((row) => outcomes.includes(row.outcome)).length;
  return {
    linked: count("linked", "added"),
    invited: count("invited"),
    skipped: count("skipped"),
    problems: result.rows
      .filter((row) => row.outcome === "refused" || row.outcome === "already_linked")
      .map((row) => ({
        label: row.email ?? row.subscriptionId,
        message: refusalMessage(row.reason),
      })),
    emailsSent,
  };
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
