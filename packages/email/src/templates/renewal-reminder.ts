import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";
import { formatMinorAmount } from "./platform-billing";

export interface RenewalReminderInput {
  readonly communityName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly renewsAt: Date;
  readonly membershipUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function renewalReminderEmail(input: RenewalReminderInput): EmailContent {
  const date = dateFormat.format(input.renewsAt);
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return buildEmail({
    template: "renewal-reminder",
    subject: `Your membership renews on ${date}`,
    preheader: `${amount} for one more year.`,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      `Your yearly membership in ${input.communityName} renews on ${date}. We will charge ${amount} for one more year.`,
      "Nothing to do if you want to stay. To change your card or cancel before then, open Manage billing.",
    ],
    cta: { label: "Manage billing", url: input.membershipUrl },
    footer: {
      why: `You received this email because you have a yearly membership in ${input.communityName} on ${instanceName()}.`,
    },
  });
}
