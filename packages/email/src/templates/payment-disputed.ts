import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";
import { formatMinorAmount } from "./platform-billing";

export interface PaymentDisputedInput {
  readonly communityName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly dashboardUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

export function paymentDisputedNoticeText(
  input: Omit<PaymentDisputedInput, "dashboardUrl" | "communityBrand">,
): string {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return `A member disputed a payment of ${amount} in ${input.communityName}. Answer it in your Stripe Dashboard before the deadline Stripe shows. The member keeps access while the dispute is open.`;
}

export function paymentDisputedEmail(input: PaymentDisputedInput): EmailContent {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return buildEmail({
    template: "payment-disputed",
    subject: `A member disputed a payment of ${amount}`,
    preheader: "Answer it in Stripe before the deadline. The member keeps access meanwhile.",
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [paymentDisputedNoticeText(input)],
    cta: { label: "Open your disputes in Stripe", url: input.dashboardUrl },
    footer: {
      why: `You received this email because you own ${input.communityName} on ${instanceName()}.`,
    },
  });
}
