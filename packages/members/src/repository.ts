import type { CommunityPrivacy, CommunityRole } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";

export interface MembersCommunity {
  readonly id: CommunityId;
  readonly privacy: CommunityPrivacy;
  readonly gamificationEnabled: boolean;
  readonly levelNames: readonly string[];
}

export interface ViewerMembership {
  readonly role: CommunityRole;
  readonly status: "pending" | "active" | "removed" | "banned";
}

export interface MemberRow {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly username: string | null;
  readonly role: CommunityRole;
  readonly joinedAt: Date;
  readonly points: number;
  readonly level: number;
  readonly bio: string | null;
}

export type MemberProfileRow = MemberRow;

export interface MemberCursor {
  readonly joinedAt: Date;
  readonly membershipId: string;
}

export interface MemberSearch {
  readonly query: string | null;
  readonly level: number | null;
  readonly after: MemberCursor | null;
  readonly limit: number;
}

export interface RecentPost {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly createdAt: Date;
}

export interface RecentComment {
  readonly id: string;
  readonly postId: string;
  readonly excerpt: string;
  readonly createdAt: Date;
}

export interface RecentActivity {
  readonly posts: readonly RecentPost[];
  readonly comments: readonly RecentComment[];
}

export interface MemberLevelRow {
  readonly userId: string;
  readonly level: number;
}

export type SetUsernameOutcome = "updated" | "taken";

export interface MemberSearchRow {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly bioHeadline: string | null;
  readonly rank: number;
}

export interface MembersRepository {
  findCommunity(communityId: CommunityId): Promise<MembersCommunity | null>;
  findAccess(communityId: CommunityId, userId: string): Promise<CommunityAccess>;
  searchMembers(communityId: CommunityId, search: MemberSearch): Promise<MemberRow[]>;
  fullTextSearch(
    communityId: CommunityId,
    tsQuery: string,
    limit: number,
  ): Promise<MemberSearchRow[]>;
  findActiveMember(communityId: CommunityId, userId: string): Promise<MemberProfileRow | null>;
  recentActivity(communityId: CommunityId, userId: string, limit: number): Promise<RecentActivity>;
  findLevels(communityId: CommunityId, userIds: readonly string[]): Promise<MemberLevelRow[]>;
  updateBio(communityId: CommunityId, userId: string, bio: string | null): Promise<void>;
  findUsername(userId: string): Promise<string | null>;
  setUsername(userId: string, username: string): Promise<SetUsernameOutcome>;
}
