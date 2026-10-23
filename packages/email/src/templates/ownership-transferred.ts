import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

export interface OwnershipTransferredInput {
  readonly communityName: string;
  readonly previousOwnerName: string;
  readonly paymentsUrl: string;
  readonly communityBrand?: CommunityBrandInput;
}

export function ownershipTransferredEmail(input: OwnershipTransferredInput): EmailContent {
  const name = input.communityName;
  const previous = input.previousOwnerName.trim() || "The previous owner";
  return buildEmail({
    template: "ownership-transferred",
    subject: "You are now the owner",
    preheader: "Choose which Stripe account takes payments. New checkouts are paused.",
    brand: communityBrand(name, input.communityBrand),
    body: [
      `${previous} made you the owner of ${name}. You can now change its settings, people, and payments in Manage.`,
      `If ${name} sells memberships, new checkouts are paused until you choose which Stripe account takes payments. Members who already pay keep their access.`,
      "You can let the previous owner's Stripe account keep receiving payments, or connect your own.",
    ],
    cta: { label: "Choose a Stripe account", url: input.paymentsUrl },
    footer: {
      why: `You received this email because you became the owner of ${name} on ${instanceName()}.`,
    },
  });
}
