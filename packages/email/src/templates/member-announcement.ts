import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

export interface MemberAnnouncementInput {
  readonly communityName: string;
  readonly communityBrand?: CommunityBrandInput;
  readonly authorName: string;
  readonly title: string | null;
  readonly bodyText: string;
  readonly postUrl: string;
  readonly optOutUrl: string;
}

const preheaderLength = 90;
const subjectLength = 80;

function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function memberAnnouncementEmail(input: MemberAnnouncementInput): EmailContent {
  const { communityName, authorName } = input;
  const title = input.title?.trim();
  const subject = title || clip(input.bodyText, subjectLength) || `A post from ${authorName}`;
  return buildEmail({
    template: "member-announcement",
    subject,
    preheader: clip(input.bodyText, preheaderLength),
    brand: communityBrand(communityName, input.communityBrand),
    body: [`${authorName} posted in ${communityName}:`, ...paragraphs(input.bodyText)],
    cta: { label: "Read and reply", url: input.postUrl },
    footer: {
      why: `You received this email because you are a member of ${communityName} and an owner or admin sent this post to all members.`,
      links: [{ label: `Stop emails from ${communityName}`, url: input.optOutUrl }],
    },
  });
}
