import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { emailGreeting, emailSafeName } from "../names";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

export interface CreatorsInviteInput {
  readonly name: string;
  readonly communityName: string;
  readonly inviterName: string | null;
  readonly url: string;
  readonly expiresAt: Date;
  readonly communityBrand?: CommunityBrandInput;
  readonly optOutUrl?: string;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function creatorsInviteEmail(input: CreatorsInviteInput): EmailContent {
  const { communityName } = input;
  const instance = instanceName();
  const inviter = emailSafeName(input.inviterName);
  return buildEmail({
    template: "creators-invite",
    subject: `You're invited to join ${communityName}`,
    preheader: `A private community for people who run communities on ${instance}.`,
    brand: communityBrand(communityName, input.communityBrand),
    body: [
      emailGreeting(input.name),
      `${inviter ?? "We"} would like you to join ${communityName}, a private community for people who run communities on ${instance}. Ask how others set things up, share what worked, and tell us what to build next.`,
      `Joining is free and takes one click. The link works once, until ${dateFormat.format(input.expiresAt)}.`,
    ],
    cta: { label: `Join ${communityName}`, url: input.url },
    footer: {
      why: `You received this email once, because you created a community on ${instance}.`,
      links: input.optOutUrl
        ? [{ label: `Don't email me about ${communityName}`, url: input.optOutUrl }]
        : [],
    },
  });
}
