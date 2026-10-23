import type { ContentDocument } from "@cohory/content";
import type { MemberAccessKind, MemberAccessMap } from "@cohory/payments";
import type { Community, Membership } from "@cohory/db";
import type {
  AppearanceTokens,
  CardStyleOption,
  CommunityPrivacy,
  FontOption,
  InviteLink,
  JoinAnswerJson,
  JoinMode,
  JoinQuestion,
  MemberRole,
  MemberStatus,
  MembershipRequest,
  MembershipRequestStatus,
  ThemeOption,
} from "@cohory/db/schema";

import { accentMessages } from "../appearance/accent";
import {
  appearanceToCssVariables,
  deriveAppearanceTokens,
  resolveAppearance,
  type AppearanceCssVariables,
} from "../appearance/tokens";
import { storedDetailedDescription } from "../description";
import { toAboutContent, type AboutContentView } from "../views";
import type { JoinRequestRow, ManageMemberRow, OverviewCounts } from "./repository";

export type OverviewStats = OverviewCounts;

export interface ManageSettingsView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly privacy: CommunityPrivacy;
  readonly gamificationEnabled: boolean;
  readonly pointsForLessons: boolean;
  readonly pointsForEvents: boolean;
  readonly reviewsEnabled: boolean;
  readonly levelNames: readonly string[];
  readonly joinMode: JoinMode;
  readonly joinQuestions: readonly JoinQuestion[];
  readonly refundPolicy: string | null;
  readonly archivedAt: Date | null;
}

export interface AppearanceNotice {
  readonly code: "fallback" | "red_hue";
  readonly message: string;
}

export interface AppearanceView {
  readonly accent: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly font: FontOption;
  readonly cardStyle: CardStyleOption;
  readonly theme: ThemeOption;
  readonly tokens: AppearanceTokens;
  readonly cssVariables: AppearanceCssVariables;
  readonly notices: readonly AppearanceNotice[];
  readonly detailedDescription: ContentDocument | null;
  readonly about: AboutContentView;
}

export interface ManageMember {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly joinedAt: Date | null;
  readonly lastActiveAt: Date;
  readonly signedIn: boolean;
  readonly access: ManageMemberAccess | null;
  readonly level: number;
  readonly points: number;
}

export interface ManageMemberAccess {
  readonly kind: MemberAccessKind | "none";
  readonly until: Date | null;
}

export interface ManageMemberDetail {
  readonly member: ManageMember;
  readonly answers: readonly JoinAnswerJson[];
  readonly requestedAt: Date | null;
}

export interface BulkFailure {
  readonly id: string;
  readonly code: string;
}

export interface BulkResult {
  readonly done: readonly string[];
  readonly failed: readonly BulkFailure[];
}

export interface ManageMemberPage {
  readonly data: readonly ManageMember[];
  readonly nextCursor: string | null;
}

export type InviteStatus = "active" | "expired" | "used_up" | "revoked";

export interface InviteLinkView {
  readonly id: string;
  readonly token: string;
  readonly path: string;
  readonly createdBy: string;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly requiresApproval: boolean;
  readonly label: string | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly status: InviteStatus;
}

export interface JoinRequestStatusView {
  readonly id: string;
  readonly status: MembershipRequestStatus;
  readonly decisionNote: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

export interface JoinStatusView {
  readonly membershipStatus: MemberStatus | null;
  readonly request: JoinRequestStatusView | null;
}

export interface JoinRequestQueueItem {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly email: string | null;
  readonly answers: readonly JoinAnswerJson[];
  readonly createdAt: Date;
}

export interface JoinRequestQueue {
  readonly data: readonly JoinRequestQueueItem[];
  readonly pendingCount: number;
}

export interface RedeemedInvite {
  readonly community: { readonly id: string; readonly slug: string; readonly name: string };
  readonly membership: Pick<
    Membership,
    "id" | "communityId" | "userId" | "role" | "status" | "joinedAt"
  > | null;
  readonly request: JoinRequestStatusView | null;
}

export interface InvitePreview {
  readonly community: { readonly slug: string; readonly name: string };
  readonly status: InviteStatus | "archived";
}

export interface MembersCsvExport {
  readonly filename: string;
  readonly body: ReadableStream<Uint8Array>;
}

export function toSettingsView(community: Community): ManageSettingsView {
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    privacy: community.privacy,
    gamificationEnabled: community.gamificationEnabled,
    pointsForLessons: community.pointsForLessons,
    pointsForEvents: community.pointsForEvents,
    reviewsEnabled: community.reviewsEnabled,
    levelNames: community.levelNames,
    joinMode: community.joinMode,
    joinQuestions: community.joinQuestions ?? [],
    refundPolicy: community.refundPolicy,
    archivedAt: community.archivedAt,
  };
}

export function toJoinRequestStatusView(request: MembershipRequest): JoinRequestStatusView {
  return {
    id: request.id,
    status: request.status,
    decisionNote: request.decisionNote,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
  };
}

export function toJoinRequestQueueItem(
  row: JoinRequestRow,
  showEmail: boolean,
): JoinRequestQueueItem {
  return {
    id: row.request.id,
    userId: row.request.userId,
    name: row.name,
    username: row.username,
    image: row.image,
    email: showEmail ? row.email : null,
    answers: row.request.answers,
    createdAt: row.request.createdAt,
  };
}

export function toAppearanceView(
  community: Community,
  brandingUrl: (key: string) => string,
): AppearanceView {
  const appearance = resolveAppearance(community.appearance);
  const tokens = community.appearanceTokens ?? deriveAppearanceTokens(community.appearance);
  const notices: AppearanceNotice[] = [];
  if (tokens.fallbackUsed) {
    notices.push({ code: "fallback", message: accentMessages.fallback });
  }
  if (tokens.warning === "red_hue") {
    notices.push({ code: "red_hue", message: accentMessages.red_hue });
  }
  return {
    accent: appearance.accent,
    logoUrl: appearance.logoKey ? brandingUrl(appearance.logoKey) : null,
    coverUrl: appearance.coverKey ? brandingUrl(appearance.coverKey) : null,
    font: appearance.font,
    cardStyle: appearance.cardStyle,
    theme: appearance.theme,
    tokens,
    cssVariables: appearanceToCssVariables(tokens),
    notices,
    detailedDescription: storedDetailedDescription(community.detailedDescription),
    about: toAboutContent(community),
  };
}

function memberAccess(userId: string, map: MemberAccessMap | null): ManageMemberAccess | null {
  if (!map) {
    return null;
  }
  const entry = map.get(userId);
  return entry ? { kind: entry.access, until: entry.until } : { kind: "none", until: null };
}

export function toManageMember(
  row: ManageMemberRow,
  showEmail: boolean,
  access: MemberAccessMap | null = null,
): ManageMember {
  return {
    userId: row.userId,
    name: row.name,
    username: row.username,
    image: row.image,
    email: showEmail ? row.email : null,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
    lastActiveAt: row.lastActiveAt,
    signedIn: row.signedIn,
    access: memberAccess(row.userId, access),
    level: row.level,
    points: row.points,
  };
}

export function inviteStatus(invite: InviteLink, now: Date): InviteStatus {
  if (invite.revokedAt) {
    return "revoked";
  }
  if (invite.expiresAt && invite.expiresAt <= now) {
    return "expired";
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    return "used_up";
  }
  return "active";
}

export function toInviteLinkView(invite: InviteLink, now: Date): InviteLinkView {
  return {
    id: invite.id,
    token: invite.token,
    path: `/join/${invite.token}`,
    createdBy: invite.createdBy,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    requiresApproval: invite.requiresApproval,
    label: invite.label,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
    status: inviteStatus(invite, now),
  };
}
