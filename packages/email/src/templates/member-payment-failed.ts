import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";
import { formatMinorAmount } from "./platform-billing";

export interface MemberPaymentFailedInput {
  readonly communityName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly nextAttemptAt: Date | null;
  readonly membershipUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function memberPaymentFailedNoticeText(
  input: Omit<MemberPaymentFailedInput, "membershipUrl" | "communityBrand">,
): string {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  const failed = `Your payment of ${amount} for ${input.communityName} failed.`;
  return input.nextAttemptAt
    ? `${failed} We will try again on ${dateFormat.format(input.nextAttemptAt)}. Update your card before then to keep your access.`
    : `${failed} That was the last try, so your access ends unless you update your card.`;
}

export function memberPaymentFailedEmail(input: MemberPaymentFailedInput): EmailContent {
  return buildEmail({
    template: "member-payment-failed",
    subject: "Your payment failed",
    preheader: input.nextAttemptAt
      ? `Update your card by ${dateFormat.format(input.nextAttemptAt)} to keep access.`
      : "Your access ends unless you update your card.",
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      memberPaymentFailedNoticeText(input),
      ...(input.nextAttemptAt ? ["You keep access while we try again."] : []),
    ],
    cta: { label: "Update payment method", url: input.membershipUrl },
    footer: {
      why: `You received this email because you have a paid membership in ${input.communityName} on ${instanceName()}.`,
    },
  });
}
