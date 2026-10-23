import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

type CompInvitationInput = {
  communityName: string;
  email: string;
  url: string;
  expiresAt: Date | null;
  communityBrand?: CommunityBrandInput;
  optOutUrl?: string;
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function compInvitationEmail({
  communityName,
  email,
  url,
  expiresAt,
  communityBrand: brand,
  optOutUrl,
}: CompInvitationInput): EmailContent {
  const until = expiresAt ? ` until ${dateFormat.format(expiresAt)}` : "";
  return buildEmail({
    template: "comp-invitation",
    subject: "You're offered free access",
    preheader: `Free access${until}. You don't pay anything.`,
    brand: communityBrand(communityName, brand),
    body: [
      `${communityName} offers you free access to its paid community${until}. You don't pay anything.`,
      `Sign in or sign up with this email address (${email}), then accept the offer on the membership page. Nothing changes until you accept.`,
    ],
    cta: { label: "Open the membership page", url },
    footer: {
      why: `You received this email because an admin of ${communityName} entered your email address. If you did not expect it, ignore it.`,
      links: optOutUrl ? [{ label: `Don't email me about ${communityName}`, url: optOutUrl }] : [],
    },
  });
}
