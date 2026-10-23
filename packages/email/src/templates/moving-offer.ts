import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

type MovingOfferInput = {
  communityName: string;
  email: string;
  url: string;
  freeUntil: Date | null;
  from: string | null;
  communityBrand?: CommunityBrandInput;
  optOutUrl?: string;
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function movingOfferEmail({
  communityName,
  email,
  url,
  freeUntil,
  from,
  communityBrand: brand,
  optOutUrl,
}: MovingOfferInput): EmailContent {
  const old = from ? `your old subscription on ${from}` : "your old subscription";
  const until = freeUntil ? dateFormat.format(freeUntil) : null;
  return buildEmail({
    template: "moving-offer",
    subject: "Keep your membership",
    preheader: until
      ? `You won't be charged until ${until}.`
      : "Start a new subscription to keep your access.",
    brand: communityBrand(communityName, brand),
    body: [
      `${communityName} has moved${from ? ` from ${from}` : ""} to ${instanceName()}. Your subscription can't move with it, so start a new one here to keep your access.`,
      until
        ? `You won't be charged until ${until}, when your old subscription would renew. Cancel ${old} now so you aren't charged twice.`
        : `Cancel ${old} once the new one starts, so you aren't charged twice.`,
      `Sign in or sign up with this email address (${email}), then choose a plan on the membership page.`,
    ],
    cta: { label: "Open the membership page", url },
    footer: {
      why: `You received this email because ${communityName} listed you as a paying member who is moving with the community.`,
      links: optOutUrl ? [{ label: `Don't email me about ${communityName}`, url: optOutUrl }] : [],
    },
  });
}
