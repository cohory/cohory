import type { EmailContent } from "../message";
import { emailGreeting } from "../names";
import {
  buildEmail,
  communityBrand,
  type CommunityBrandInput,
  type EmailBlock,
  type EmailLink,
} from "./layout";

type FooterLinks = {
  unsubscribeUrl: string;
  preferencesUrl: string;
};

export type NotificationEmailItem = {
  sentence: string;
  excerpt?: string | null;
};

type NotificationEmailInput = FooterLinks & {
  name: string | null;
  subject: string;
  heading?: string;
  items: readonly NotificationEmailItem[];
  cta: EmailLink;
  communityName: string;
  reason: string;
  stopLabel?: string;
  communityBrand?: CommunityBrandInput;
};

type DigestItem = {
  text: string;
  communityName: string;
  url: string;
};

type DigestEmailInput = FooterLinks & {
  name: string | null;
  subject: string;
  items: readonly DigestItem[];
};

function quoted(excerpt: string | null | undefined): string | null {
  return excerpt ? `"${excerpt}"` : null;
}

function footerLinks(stopLabel: string, links: FooterLinks) {
  return [
    { label: stopLabel, url: links.unsubscribeUrl },
    { label: "Change your notification settings", url: links.preferencesUrl },
  ];
}

export function notificationEmail(input: NotificationEmailInput): EmailContent {
  const [first] = input.items;
  const preheader =
    input.heading ?? [first?.sentence, quoted(first?.excerpt)].filter(Boolean).join(" ");
  const items = input.items.flatMap((item) => {
    const quote = quoted(item.excerpt);
    return quote ? [item.sentence, quote] : [item.sentence];
  });
  return buildEmail({
    template: "notification",
    subject: input.subject,
    preheader,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [emailGreeting(input.name), ...(input.heading ? [input.heading] : []), ...items],
    cta: input.cta,
    footer: {
      why: `You get this email because email for ${input.reason} is on.`,
      links: footerLinks(input.stopLabel ?? "Stop these emails", input),
    },
  });
}

function byCommunity(items: readonly DigestItem[]): EmailBlock[] {
  const groups = new Map<string, DigestItem[]>();
  for (const item of items) {
    groups.set(item.communityName, [...(groups.get(item.communityName) ?? []), item]);
  }
  return [...groups].flatMap(([communityName, group]) => [
    communityName,
    { kind: "list", items: group.map((item) => ({ label: item.text, url: item.url })) },
  ]);
}

export function notificationDigestEmail(input: DigestEmailInput): EmailContent {
  const [first] = input.items;
  const more = input.items.length > 1 ? ` and ${input.items.length - 1} more` : "";
  return buildEmail({
    template: "notification-digest",
    subject: input.subject,
    preheader: first ? `${first.text} in ${first.communityName}${more}.` : "",
    brand: { kind: "instance" },
    body: [
      emailGreeting(input.name),
      "Here is what happened in your communities since your last summary.",
      ...byCommunity(input.items),
    ],
    footer: {
      why: "You get this summary because you chose daily email for these notifications.",
      links: footerLinks("Stop daily summaries", input),
    },
  });
}
