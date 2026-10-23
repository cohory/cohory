import type {
  Community,
  CommunityId,
  CommunityMembership,
  CommunitySlug,
  CreateOwnedCommunityResult,
  Membership,
  NewMembership,
  NewOwnedCommunity,
} from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";
import type { CommunityGalleryItem, MemberStatus } from "@cohory/db/schema";

import type { AboutPeople, MemberListItem } from "./views";

export interface NameSearch {
  readonly prefix: string;
  readonly limit: number;
}

export interface CommunitiesRepository {
  createCommunityWithOwner(input: NewOwnedCommunity): Promise<CreateOwnedCommunityResult>;
  findCommunityBySlug(slug: CommunitySlug): Promise<Community | null>;
  findMovedCommunitySlug(formerSlug: CommunitySlug): Promise<string | null>;
  findCommunityById(id: CommunityId): Promise<Community | null>;
  findConfirmedEmail(userId: string): Promise<string | null>;
  findMembership(communityId: CommunityId, userId: string): Promise<Membership | null>;
  findAccess(communityId: CommunityId, userId: string): Promise<CommunityAccess>;
  insertMembershipIfAbsent(
    communityId: CommunityId,
    input: NewMembership,
  ): Promise<{ membership: Membership; created: boolean }>;
  setMembershipStatus(
    communityId: CommunityId,
    userId: string,
    status: MemberStatus,
    joinedAt?: Date,
  ): Promise<Membership | null>;
  leaveMembership(communityId: CommunityId, userId: string): Promise<Membership | null>;
  dismissOnboarding(communityId: CommunityId, userId: string, at: Date): Promise<void>;
  listCommunitiesForUser(userId: string): Promise<CommunityMembership[]>;
  countActiveMembers(communityId: CommunityId): Promise<number>;
  countActiveMembersIn(
    communityIds: readonly CommunityId[],
  ): Promise<ReadonlyMap<CommunityId, number>>;
  hasPaidTransactionSince(communityId: CommunityId, since: Date): Promise<boolean>;
  isEmailBanned(communityId: CommunityId, userId: string): Promise<boolean>;
  searchActiveMembers(communityId: CommunityId, search: NameSearch): Promise<MemberListItem[]>;
  listGallery(communityId: CommunityId): Promise<CommunityGalleryItem[]>;
  aboutPeople(communityId: CommunityId, avatarLimit: number): Promise<AboutPeople>;
}
