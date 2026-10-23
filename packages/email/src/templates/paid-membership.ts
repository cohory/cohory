import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput, type EmailBlock } from "./layout";

export type PaidMembershipChange =
  | "community_deleted"
  | "archived_ending"
  | "archived_continuing"
  | "billed_by_creator"
  | "winding_down";

export interface PaidMembershipChangedInput {
  readonly communityName: string;
  readonly change: PaidMembershipChange;
  readonly endsAt: Date | null;
  readonly supportContact: string | null;
  readonly portalLoginUrl: string | null;
  readonly membershipUrl: string | null;
  readonly communityBrand?: CommunityBrandInput;
}

export interface FeeClearRequiredInput {
  readonly communityName: string;
  readonly dashboardUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function endsOn(endsAt: Date | null): string {
  return endsAt
    ? `Your subscription ends on ${dateFormat.format(endsAt)} and will not renew.`
    : "Your subscription ends at the end of the current billing period and will not renew.";
}

interface Copy {
  readonly subject: string;
  readonly preheader: string;
  readonly lead: string;
  readonly extra: readonly EmailBlock[];
  readonly portalUrl?: string;
}

type CopyInput = Omit<PaidMembershipChangedInput, "membershipUrl" | "communityBrand">;

export function paidMembershipNoticeText(input: CopyInput): string {
  return copyFor(input).lead;
}

function copyFor(input: CopyInput): Copy {
  const name = input.communityName;
  switch (input.change) {
    case "community_deleted":
      return {
        subject: "Your membership has ended",
        preheader: "You will not be charged again.",
        lead: `${name} has closed. We cancelled your subscription, so you will not be charged again.`,
        extra: [],
      };
    case "archived_ending":
      return {
        subject: "Your membership will not renew",
        preheader: endsOn(input.endsAt),
        lead: `${name} is archived. ${endsOn(input.endsAt)} You can read the community until then.`,
        extra: [],
      };
    case "archived_continuing":
      return {
        subject: "The community is archived",
        preheader: "Your subscription continues and you can still read the community.",
        lead: `${name} is archived. Your subscription continues and you can still read the community. To stop paying, open Manage billing on your membership page.`,
        extra: [],
      };
    case "billed_by_creator": {
      const contact = input.supportContact ? ` or contact ${input.supportContact}` : "";
      return {
        subject: `Your membership is now billed by ${name}`,
        preheader: "To change or cancel it, use the link in your Stripe receipt emails.",
        lead: `Your membership is now billed directly by ${name}. To change or cancel it, use the link in your Stripe receipt emails${contact}.`,
        extra: [],
        ...(input.portalLoginUrl ? { portalUrl: input.portalLoginUrl } : {}),
      };
    }
    case "winding_down":
      return {
        subject: "Your membership will not renew",
        preheader: endsOn(input.endsAt),
        lead: `${name} has stopped selling memberships through ${instanceName()}. ${endsOn(input.endsAt)}`,
        extra: [],
      };
  }
}

export function paidMembershipChangedEmail(input: PaidMembershipChangedInput): EmailContent {
  const copy = copyFor(input);
  const membership = input.membershipUrl
    ? { label: "Open your membership", url: input.membershipUrl }
    : undefined;
  return buildEmail({
    template: "paid-membership-changed",
    subject: copy.subject,
    preheader: copy.preheader,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      copy.lead,
      ...copy.extra,
      ...(copy.portalUrl && membership ? [{ kind: "link" as const, ...membership }] : []),
    ],
    cta: copy.portalUrl ? { label: "Manage your billing", url: copy.portalUrl } : membership,
    footer: {
      why: `You received this email because you have a paid membership in ${input.communityName}.`,
    },
  });
}

export function feeClearRequiredEmail({
  communityName,
  dashboardUrl,
  communityBrand: brand,
}: FeeClearRequiredInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "fee-clear-required",
    subject: `Remove the ${instance} fee in your Stripe Dashboard`,
    preheader: "Remove the application fee from each subscription in Stripe.",
    brand: communityBrand(communityName, brand),
    body: [
      `${communityName} is no longer connected to ${instance}, so we can no longer change your subscriptions. Some of them may still carry the ${instance} platform fee. Open each subscription in your Stripe Dashboard and remove the application fee. We refund any platform fee we receive after you left.`,
    ],
    cta: { label: "Open your Stripe Dashboard", url: dashboardUrl },
    footer: { why: `You received this email because you own ${communityName} on ${instance}.` },
  });
}
