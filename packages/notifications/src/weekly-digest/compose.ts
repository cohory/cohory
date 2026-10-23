import type { CommunityBrandInput, WeeklyDigestCommunity } from "@cohory/email";

export const weeklyDigestMinPosts = 2;
export const weeklyDigestTopPosts = 3;
export const weeklyDigestEvents = 2;
export const weeklyDigestMemberNames = 3;
export const weeklyDigestMinGapMs = 6 * 24 * 60 * 60 * 1000;
export const weekMs = 7 * 24 * 60 * 60 * 1000;

const firstLineMax = 140;

export interface DigestPost {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly commentCount: number;
}

export interface DigestOccurrence {
  readonly id: string;
  readonly eventSlug: string;
  readonly title: string;
  readonly startsAt: Date;
}

export interface DigestProgress {
  readonly courseSlug: string;
  readonly courseTitle: string;
  readonly lessonSlug: string;
  readonly lessonTitle: string;
  readonly percent: number;
}

export interface CommunityActivity {
  readonly newPostCount: number;
  readonly topPosts: readonly DigestPost[];
  readonly events: readonly DigestOccurrence[];
  readonly progress: DigestProgress | null;
}

export interface DigestFeed {
  readonly newPostCount: number;
  readonly topPosts: readonly DigestPost[];
}

export interface DigestExtras {
  readonly events: readonly DigestOccurrence[];
  readonly progress: DigestProgress | null;
}

export interface WeeklyDigestSourceInput {
  readonly userId: string;
  readonly communityId: string;
  readonly since: Date;
  readonly now: Date;
}

export interface WeeklyDigestSource {
  feed(input: WeeklyDigestSourceInput): Promise<DigestFeed | null>;
  extras(input: WeeklyDigestSourceInput): Promise<DigestExtras>;
}

export interface DigestMembers {
  readonly count: number;
  readonly names: readonly string[];
}

export interface DigestMoney {
  readonly joined: number;
  readonly canceled: number;
}

export interface ComposeInput {
  readonly appUrl: string;
  readonly timeZone: string;
  readonly community: {
    readonly slug: string;
    readonly name: string;
    readonly brand?: CommunityBrandInput;
  };
  readonly activity: CommunityActivity;
  readonly members: DigestMembers;
  readonly money: DigestMoney | null;
}

export function localParts(at: Date, timeZone: string): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "-1");
  return { weekday, hour };
}

export function isWeeklyDigestDue(input: {
  readonly at: Date;
  readonly timeZone: string;
  readonly digestHour: number;
  readonly lastSentAt: Date | null;
}): boolean {
  const local = localParts(input.at, input.timeZone);
  if (local.weekday !== "Monday" || local.hour !== input.digestHour) {
    return false;
  }
  return (
    input.lastSentAt === null ||
    input.at.getTime() - input.lastSentAt.getTime() >= weeklyDigestMinGapMs
  );
}

function firstLine(excerpt: string): string {
  const line =
    excerpt
      .split(/\r?\n/)
      .find((part) => part.trim() !== "")
      ?.trim() ?? "";
  return line.length > firstLineMax ? `${line.slice(0, firstLineMax - 3).trimEnd()}...` : line;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function moneySummary(money: DigestMoney | null): string | null {
  if (!money || (money.joined === 0 && money.canceled === 0)) {
    return null;
  }
  const parts: string[] = [];
  if (money.joined > 0) {
    parts.push(plural(money.joined, "new paying member"));
  }
  if (money.canceled > 0) {
    parts.push(plural(money.canceled, "cancellation"));
  }
  return `Paid memberships this week: ${parts.join(", ")}.`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function composeCommunity(input: ComposeInput): WeeklyDigestCommunity {
  const { activity, community } = input;
  const base = `${input.appUrl}/c/${segment(community.slug)}`;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, weekday: "long" });
  const progress = activity.progress;
  return {
    name: community.name,
    url: base,
    communityBrand: community.brand,
    newPostCount: activity.newPostCount,
    newMemberCount: input.members.count,
    newMemberNames: input.members.names.slice(0, weeklyDigestMemberNames),
    topPosts: activity.topPosts.slice(0, weeklyDigestTopPosts).map((post) => {
      const line = firstLine(post.excerpt);
      const title = post.title?.trim() || line || "A post";
      return {
        title,
        firstLine: post.title?.trim() ? line : "",
        commentCount: post.commentCount,
        url: `${base}/posts/${segment(post.id)}`,
      };
    }),
    events: activity.events.slice(0, weeklyDigestEvents).map((event) => ({
      title: event.title,
      when: when.format(event.startsAt),
      day: day.format(event.startsAt),
      url: `${base}/calendar/${segment(event.eventSlug)}/${segment(event.id)}`,
    })),
    progress: progress
      ? {
          text: `You are ${progress.percent}% through ${progress.courseTitle}. Next: ${progress.lessonTitle}.`,
          url: `${base}/classroom/${segment(progress.courseSlug)}/${segment(progress.lessonSlug)}`,
        }
      : null,
    ownerSummary: moneySummary(input.money),
  };
}
