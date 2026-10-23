import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

export interface TokenExpiringInput {
  readonly communityName: string;
  readonly tokenName: string;
  readonly agentName: string | null;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly url: string;
  readonly communityBrand?: CommunityBrandInput;
}

const day = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

const dayMs = 24 * 60 * 60 * 1000;

function remaining(expiresAt: Date, now: Date): string {
  const days = Math.floor((expiresAt.getTime() - now.getTime()) / dayMs);
  return days < 1 ? "within a day" : `in ${days} ${days === 1 ? "day" : "days"}`;
}

export function tokenExpiringEmail(input: TokenExpiringInput): EmailContent {
  const when = day.format(input.expiresAt);
  const owner = input.agentName ? `Your agent ${input.agentName} uses the token` : "Your token";
  return buildEmail({
    template: "token-expiring",
    subject: `Your token ${input.tokenName} expires ${remaining(input.expiresAt, input.now)}`,
    preheader: `It stops working on ${when} (UTC).`,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      `${owner} ${input.tokenName} in ${input.communityName}. It stops working on ${when} (UTC), and anything that uses it stops with it.`,
      "Choose Regenerate to get a new token with the same name and permissions, then put it where the old one was. The old token stops working as soon as you regenerate.",
    ],
    cta: { label: "Open your tokens", url: input.url },
    footer: {
      why: `You received this email because you created this token on ${instanceName()}.`,
    },
  });
}
