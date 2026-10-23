import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";
import { formatMinorAmount } from "./platform-billing";

export interface DuplicateRefundedInput {
  readonly communityName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly membershipUrl: string | null;
  readonly communityBrand?: CommunityBrandInput;
}

export function duplicateRefundedEmail(input: DuplicateRefundedInput): EmailContent {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return buildEmail({
    template: "duplicate-refunded",
    subject: `We refunded your second payment of ${amount}`,
    preheader: "You paid twice, so we cancelled the second subscription. Your access stays.",
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      `You started two paid memberships in ${input.communityName}, so we cancelled the second one and refunded ${amount}.`,
      "Your first membership keeps running and you keep your access. The refund usually reaches your card within 5 to 10 business days.",
    ],
    ...(input.membershipUrl
      ? { cta: { label: "View your membership", url: input.membershipUrl } }
      : {}),
    footer: {
      why: `You received this email because you pay for a membership in ${input.communityName} on ${instanceName()}.`,
    },
  });
}
