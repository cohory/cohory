import type { Community, CommunityId, CommunitySlug, Membership, ScopedQueries } from "@cohory/db";
import type {
  AppearanceTokens,
  AuditActorType,
  AuditVia,
  CommunityAppearance,
  CommunityGalleryItem,
  CommunityPrivacy,
  ContentDocumentJson,
  FaqItem,
  GalleryItemKind,
  InviteLink,
  JoinAnswerJson,
  JoinMode,
  JoinQuestion,
  MemberRole,
  MemberStatus,
  MembershipRequest,
} from "@cohory/db/schema";

import type { MembershipEvent } from "./events";
import type { CommunityHealth, HealthWindow } from "./health";
import type { SetupCounts } from "./setup-checklist";

export interface MembershipHoldInput {
  readonly inviteId: string;
  readonly expiresAt: Date;
}

export interface MemberRecord {
  readonly role: MemberRole;
  readonly status: MemberStatus;
}

export interface CommunityPatch {
  readonly slug?: CommunitySlug;
  readonly slugChangedAt?: Date;
  readonly name?: string;
  readonly description?: string | null;
  readonly privacy?: CommunityPrivacy;
  readonly gamificationEnabled?: boolean;
  readonly pointsForLessons?: boolean;
  readonly pointsForEvents?: boolean;
  readonly reviewsEnabled?: boolean;
  readonly levelNames?: string[];
  readonly joinMode?: JoinMode;
  readonly joinQuestions?: JoinQuestion[];
  readonly refundPolicy?: string | null;
  readonly appearance?: CommunityAppearance;
  readonly appearanceTokens?: AppearanceTokens;
  readonly detailedDescription?: ContentDocumentJson | null;
  readonly whatYouGet?: string[] | null;
  readonly hostBio?: string | null;
  readonly hostCredential?: string | null;
  readonly faq?: FaqItem[] | null;
  readonly archivedAt?: Date | null;
  readonly setupChecklistHiddenAt?: Date;
  readonly setupImportSkippedAt?: Date;
  readonly aboutPreviewedAt?: Date;
  readonly inviteLinkCopiedAt?: Date;
}

export interface NewGalleryItem {
  readonly kind: GalleryItemKind;
  readonly storageKey: string | null;
  readonly embedUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly altText: string | null;
  readonly position: number;
}

export interface ManageMemberRow {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly email: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly joinedAt: Date | null;
  readonly sortAt: Date;
  readonly lastActiveAt: Date;
  readonly signedIn: boolean;
  readonly level: number;
  readonly points: number;
}

export interface ManageMemberCursor {
  readonly sortAt: Date;
  readonly membershipId: string;
}

export interface MemberCriteria {
  readonly query: string | null;
  readonly searchEmail: boolean;
  readonly role: MemberRole | null;
  readonly status: MemberStatus | null;
  readonly inactiveBefore: Date | null;
  readonly neverSignedIn: boolean;
  readonly userIds: UserIdFilter | null;
}

export interface UserIdFilter {
  readonly mode: "include" | "exclude";
  readonly ids: readonly string[];
}

export interface ManageMemberFilter extends MemberCriteria {
  readonly cursor: ManageMemberCursor | null;
  readonly limit: number;
}

export interface LastSeenBatch {
  readonly updated: number;
}

export interface OverviewCounts {
  readonly memberCount: number;
  readonly newMembers7d: number;
  readonly posts7d: number;
  readonly comments7d: number;
  readonly upcomingEvents: number;
  readonly publishedCourses: number;
}

export interface NewInviteLink {
  readonly token: string;
  readonly createdBy: string;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly requiresApproval: boolean;
  readonly label: string | null;
}

export interface JoinRequestRow {
  readonly request: MembershipRequest;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly email: string;
}

export interface JoinDecision {
  readonly status: "approved" | "declined";
  readonly note: string | null;
  readonly decidedBy: string;
  readonly decidedAt: Date;
}

export interface AuditEntry {
  readonly actorId: string;
  readonly action: string;
  readonly target: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface AuditFilter {
  readonly action: string | null;
  readonly actorType: AuditActorType | null;
  readonly via: AuditVia | null;
  readonly agentId: string | null;
  readonly tokenId: string | null;
  readonly excludeActions: readonly string[];
  readonly credentialActorId: string | null;
  readonly from: Date | null;
  readonly before: Date | null;
  readonly cursor: AuditCursor | null;
  readonly limit: number;
}

export interface AuditRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorType: AuditActorType | null;
  readonly via: AuditVia | null;
  readonly tokenId: string | null;
  readonly agentId: string | null;
  readonly agentName: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly targetName: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export type DeletionGate = (queries: ScopedQueries) => Promise<boolean>;

export interface ManageStore {
  enableManagement(): Promise<void>;
  findCommunity(): Promise<Community | null>;
  updateCommunity(patch: CommunityPatch): Promise<Community>;
  deleteCommunity(gate: DeletionGate): Promise<boolean>;
  lockCommunity(): Promise<void>;

  listGallery(): Promise<CommunityGalleryItem[]>;
  insertGalleryItem(item: NewGalleryItem): Promise<CommunityGalleryItem>;
  updateGalleryAltText(
    itemId: string,
    altText: string | null,
  ): Promise<CommunityGalleryItem | null>;
  deleteGalleryItem(itemId: string): Promise<CommunityGalleryItem | null>;
  setGalleryPositions(itemIds: readonly string[]): Promise<void>;

  findMember(userId: string): Promise<Membership | null>;
  findUserEmail(userId: string): Promise<string | null>;
  isEmailBanned(email: string): Promise<boolean>;
  setRole(userId: string, role: MemberRole): Promise<void>;
  setStatus(
    userId: string,
    status: MemberStatus,
    options?: {
      bannedEmail?: string | null;
      joinedAt?: Date;
      role?: MemberRole;
      removedByStaff?: boolean;
    },
  ): Promise<Membership | null>;
  insertMembershipIfAbsent(userId: string, joinedAt: Date): Promise<Membership | null>;
  holdMembership(userId: string, hold: MembershipHoldInput): Promise<boolean>;
  listMembers(filter: ManageMemberFilter): Promise<ManageMemberRow[]>;
  overviewCounts(now: Date, since: Date): Promise<OverviewCounts>;
  setupCounts(now: Date): Promise<SetupCounts>;
  communityHealth(window: HealthWindow): Promise<CommunityHealth>;
  countActiveMembers(): Promise<number>;
  hasPaidTransactionSince(since: Date): Promise<boolean>;

  insertInvite(invite: NewInviteLink): Promise<InviteLink>;
  listInvites(): Promise<InviteLink[]>;
  revokeInvite(inviteId: string, at: Date): Promise<InviteLink | null>;
  consumeInvite(inviteId: string, now: Date): Promise<boolean>;

  insertJoinRequest(
    userId: string,
    answers: readonly JoinAnswerJson[],
  ): Promise<MembershipRequest | null>;
  findLatestJoinRequest(userId: string): Promise<MembershipRequest | null>;
  findPaidJoinAnswers(userId: string): Promise<readonly JoinAnswerJson[]>;
  findJoinRequest(requestId: string): Promise<MembershipRequest | null>;
  listPendingJoinRequests(limit: number): Promise<JoinRequestRow[]>;
  countPendingJoinRequests(): Promise<number>;
  decideJoinRequest(requestId: string, decision: JoinDecision): Promise<MembershipRequest | null>;

  appendAudit(entry: AuditEntry): Promise<void>;
  appendMembershipEvents(events: readonly MembershipEvent[]): Promise<void>;
  listAudit(filter: AuditFilter): Promise<AuditRow[]>;
  listAuditActions(): Promise<string[]>;
}

export interface ScopeOptions {
  readonly userId?: string;
  readonly inviteToken?: string;
}

export interface InviteLookup {
  readonly id: string;
  readonly communityId: CommunityId;
  readonly invite: InviteLink;
}

export interface ManageRepository {
  findCommunity(communityId: CommunityId): Promise<Community | null>;
  findMember(communityId: CommunityId, userId: string): Promise<MemberRecord | null>;
  findInviteByToken(token: string): Promise<InviteLookup | null>;
  inCommunity<T>(
    communityId: CommunityId,
    options: ScopeOptions,
    fn: (store: ManageStore) => Promise<T>,
  ): Promise<T>;
  exportMembers(
    communityId: CommunityId,
    criteria: MemberCriteria,
    afterMembershipId: string | null,
    limit: number,
  ): Promise<ManageMemberRow[]>;
  listCommunityIds(afterId: string | null, limit: number): Promise<CommunityId[]>;
  backfillLastSeen(communityId: CommunityId, limit: number): Promise<LastSeenBatch>;
}
