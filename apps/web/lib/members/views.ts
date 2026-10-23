import type { Leaderboard, LearningPoints } from "@cohory/gamification";
import { levelName, maxLevel, progressToNextLevel } from "@cohory/gamification";
import type {
  GamificationSettings,
  MemberProfile,
  MemberSummary,
  RecentActivity,
} from "@cohory/members";
import type {
  ActivityItem,
  LeaderboardEntry as LeaderboardEntryProps,
  LeaderboardViewer as LeaderboardViewerProps,
  LevelLadderStep,
  LevelOption,
  MemberListItem,
  MemberSummary as MemberCardData,
} from "@cohory/ui";

export type { GamificationSettings };

export function distinctLevelName(level: number, name: string | null): string | null {
  return name && name !== `Level ${level}` ? name : null;
}

export function memberHref(slug: string, userId: string): string {
  return `/c/${slug}/members/${userId}`;
}

export const newMemberDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

export function toMemberCardData(member: MemberSummary, now = new Date()): MemberCardData {
  return {
    userId: member.userId,
    name: member.name,
    username: member.username,
    image: member.image,
    role: member.role,
    level: member.level ?? 1,
    levelName: member.level === null ? null : distinctLevelName(member.level, member.levelName),
    points: member.points ?? 0,
    joinedAt: member.joinedAt.toISOString(),
    bio: member.bio,
    isNew: now.getTime() - member.joinedAt.getTime() < newMemberDays * dayMs,
  };
}

export function toMemberListItems(
  slug: string,
  members: readonly MemberSummary[],
  now = new Date(),
): MemberListItem[] {
  return members.map((member) => ({
    member: toMemberCardData(member, now),
    href: memberHref(slug, member.userId),
  }));
}

export function levelOptions(settings: GamificationSettings): LevelOption[] {
  if (!settings.enabled) return [];
  return Array.from({ length: maxLevel }, (_, index) => ({
    level: index + 1,
    name: distinctLevelName(index + 1, levelName(index + 1, settings.levelNames)),
  }));
}

export interface ProfileView {
  readonly member: MemberCardData;
  readonly bio: string | null;
  readonly gamificationEnabled: boolean;
  readonly nextLevelAt: number | null;
  readonly activity: ActivityItem[];
}

export function toActivityItems(slug: string, activity: RecentActivity): ActivityItem[] {
  const posts = activity.posts.map((post) => ({
    type: "post" as const,
    title: post.title,
    excerpt: post.excerpt,
    href: `/c/${slug}/posts/${post.id}`,
    createdAt: post.createdAt,
  }));
  const comments = activity.comments.map((comment) => ({
    type: "comment" as const,
    title: null,
    excerpt: comment.excerpt,
    href: `/c/${slug}/posts/${comment.postId}#comments`,
    createdAt: comment.createdAt,
  }));
  return [...posts, ...comments]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }));
}

export function toProfileView(slug: string, profile: MemberProfile): ProfileView {
  const gamificationEnabled = profile.points !== null && profile.level !== null;
  return {
    member: toMemberCardData(profile),
    bio: profile.bio,
    gamificationEnabled,
    nextLevelAt: gamificationEnabled
      ? progressToNextLevel(profile.points ?? 0).nextThreshold
      : null,
    activity: toActivityItems(slug, profile.recentActivity),
  };
}

export interface ViewerProgress {
  readonly level: number;
  readonly name: string | null;
  readonly points: number;
  readonly nextLevelAt: number | null;
}

export type LeaderboardView =
  | { readonly status: "disabled" }
  | {
      readonly status: "enabled";
      readonly entries: LeaderboardEntryProps[];
      readonly viewer: LeaderboardViewerProps | null;
      readonly progress: ViewerProgress | null;
      readonly ladder: LevelLadderStep[];
      readonly earningLine: string;
    };

export function earningLine(earning: LearningPoints): string {
  const ways = [
    "each like on your posts and comments",
    ...(earning.lessons ? ["each lesson you finish"] : []),
    ...(earning.events ? ["each event you attend"] : []),
  ];
  const last = ways.pop();
  const joined =
    ways.length === 0
      ? last
      : ways.length === 1
        ? `${ways[0]} and ${last}`
        : `${ways.join(", ")}, and ${last}`;
  return `You earn 1 point for ${joined}.`;
}

export function toLeaderboardView(slug: string, board: Leaderboard): LeaderboardView {
  if (board.status === "disabled") return { status: "disabled" };
  const viewer = board.viewer;
  return {
    status: "enabled",
    entries: board.entries.map((entry) => ({
      rank: entry.rank,
      points: entry.points,
      href: memberHref(slug, entry.userId),
      member: {
        userId: entry.userId,
        name: entry.name,
        image: entry.image,
        level: entry.level,
        levelName: distinctLevelName(entry.level, entry.levelName),
      },
    })),
    viewer: viewer && viewer.rank !== null ? { rank: viewer.rank, points: viewer.points } : null,
    progress: viewer
      ? {
          level: viewer.level,
          name: distinctLevelName(viewer.level, viewer.levelName),
          points: viewer.totalPoints,
          nextLevelAt: progressToNextLevel(viewer.totalPoints).nextThreshold,
        }
      : null,
    ladder: board.ladder.map((step) => ({
      level: step.level,
      name: distinctLevelName(step.level, step.name),
      minPoints: step.minPoints,
      share: step.share,
    })),
    earningLine: earningLine(board.earning),
  };
}

export interface AuthorLevel {
  readonly level: number;
  readonly name: string | null;
}

export function authorLevelFor(
  settings: GamificationSettings,
  level: number | undefined,
): AuthorLevel | null {
  if (!settings.enabled) return null;
  const value = level ?? 1;
  return { level: value, name: distinctLevelName(value, levelName(value, settings.levelNames)) };
}
