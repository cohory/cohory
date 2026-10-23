import type { CommunityRole } from "@cohory/authz";

import type { RecentActivity } from "./repository";

export interface MemberSummary {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly username: string | null;
  readonly role: CommunityRole;
  readonly joinedAt: Date;
  readonly points: number | null;
  readonly level: number | null;
  readonly levelName: string | null;
  readonly bio: string | null;
}

export interface MemberProfile extends MemberSummary {
  readonly recentActivity: RecentActivity;
}

export interface GamificationSettings {
  readonly enabled: boolean;
  readonly levelNames: readonly string[];
}

export interface MemberPage {
  readonly data: readonly MemberSummary[];
  readonly nextCursor: string | null;
}
