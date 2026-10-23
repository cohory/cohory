import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput, type EmailBlock } from "./layout";

export interface WeeklyDigestPost {
  readonly title: string;
  readonly firstLine: string;
  readonly commentCount: number;
  readonly url: string;
}

export interface WeeklyDigestEvent {
  readonly title: string;
  readonly when: string;
  readonly day: string;
  readonly url: string;
}

export interface WeeklyDigestCommunity {
  readonly name: string;
  readonly url: string;
  readonly newPostCount: number;
  readonly newMemberCount: number;
  readonly newMemberNames: readonly string[];
  readonly topPosts: readonly WeeklyDigestPost[];
  readonly events: readonly WeeklyDigestEvent[];
  readonly progress: { readonly text: string; readonly url: string } | null;
  readonly ownerSummary: string | null;
  readonly communityBrand?: CommunityBrandInput;
}

export interface WeeklyDigestInput {
  readonly name: string;
  readonly communities: readonly WeeklyDigestCommunity[];
  readonly unsubscribeUrl: string;
  readonly preferencesUrl: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function summaryLine(community: WeeklyDigestCommunity): string {
  const parts = [plural(community.newPostCount, "new post")];
  if (community.newMemberCount > 0) {
    parts.push(plural(community.newMemberCount, "new member"));
  }
  const [next] = community.events;
  if (next) {
    parts.push(`next event ${next.day}`);
  }
  return `${parts.join(", ")}.`;
}

function membersLine(community: WeeklyDigestCommunity): string | null {
  const names = community.newMemberNames.filter((name) => name.trim() !== "");
  if (names.length === 0) {
    return null;
  }
  const rest = community.newMemberCount - names.length;
  const more = rest > 0 ? `, and ${rest} more` : "";
  return `New members: ${names.join(", ")}${more}.`;
}

function postNote(post: WeeklyDigestPost): string {
  const comments = plural(post.commentCount, "comment");
  return post.firstLine.trim() ? `${sentence(post.firstLine)} ${comments}` : comments;
}

function communityBlocks(community: WeeklyDigestCommunity): EmailBlock[] {
  const blocks: EmailBlock[] = [summaryLine(community)];
  if (community.topPosts.length > 0) {
    blocks.push({
      kind: "list",
      items: community.topPosts.map((post) => ({
        label: post.title,
        url: post.url,
        note: postNote(post),
      })),
    });
  }
  const members = membersLine(community);
  if (members) {
    blocks.push(members);
  }
  if (community.events.length > 0) {
    blocks.push("Coming up:", {
      kind: "list",
      items: community.events.map((event) => ({
        label: event.title,
        url: event.url,
        note: event.when,
      })),
    });
  }
  if (community.progress) {
    blocks.push({ kind: "link", label: community.progress.text, url: community.progress.url });
  }
  if (community.ownerSummary) {
    blocks.push(community.ownerSummary);
  }
  return blocks;
}

const footerWhy = "You get this email because weekly digests are on.";

function footer(input: WeeklyDigestInput) {
  return {
    why: footerWhy,
    links: [
      { label: "Stop weekly digests", url: input.unsubscribeUrl },
      { label: "Change your notification settings", url: input.preferencesUrl },
    ],
  };
}

export function weeklyDigestEmail(input: WeeklyDigestInput): EmailContent {
  const [only, ...others] = input.communities;
  if (only && others.length === 0) {
    const [top] = only.topPosts;
    const headline = top ? top.title : plural(only.newPostCount, "new post");
    return buildEmail({
      template: "weekly-digest",
      subject: `This week: ${headline}`,
      preheader: `${only.name}: ${summaryLine(only)}`,
      brand: communityBrand(only.name, only.communityBrand),
      body: [`Hi ${input.name},`, `Here is your week in ${only.name}.`, ...communityBlocks(only)],
      cta: { label: `Open ${only.name}`, url: only.url },
      footer: footer(input),
    });
  }
  return buildEmail({
    template: "weekly-digest",
    subject: "This week in your communities",
    preheader: input.communities.map((community) => community.name).join(", "),
    brand: { kind: "instance" },
    body: [
      `Hi ${input.name},`,
      "Here is your week in your communities.",
      ...input.communities.flatMap((community): EmailBlock[] => [
        { kind: "link", label: `Open ${community.name}`, url: community.url },
        ...communityBlocks(community),
      ]),
    ],
    footer: footer(input),
  });
}
