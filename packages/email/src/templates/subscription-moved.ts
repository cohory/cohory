import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

type SubscriptionMovedInput = {
  communityName: string;
  email: string;
  url: string;
  communityBrand?: CommunityBrandInput;
};

export function subscriptionMovedEmail({
  communityName,
  email,
  url,
  communityBrand: brand,
}: SubscriptionMovedInput): EmailContent {
  return buildEmail({
    template: "subscription-moved",
    subject: "Your membership has moved",
    preheader: "You don't pay again. Sign up with this email address to get in.",
    brand: communityBrand(communityName, brand),
    body: [
      `Your paid membership in ${communityName} has moved to ${instanceName()}. You don't pay again, and your card and renewal date stay the same.`,
      `Sign up with this email address (${email}) to get in. If you already have an account with it, sign in instead.`,
    ],
    cta: { label: "Open the membership page", url },
    after: [
      "Confirm your email address when we ask. Your membership starts as soon as it is confirmed.",
    ],
    footer: {
      why: `You received this email because ${communityName} linked your existing subscription to its community.`,
    },
  });
}
