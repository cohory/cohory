import type { ContentDocument } from "@cohory/content";
import type { Community, CommunityMembership, Membership } from "@cohory/db";
import type { FaqItem, JoinQuestion, MemberRole } from "@cohory/db/schema";

import { storedDetailedDescription } from "./description";
import type { GalleryItemView } from "./gallery";

export type CommunityView = Pick<
  Community,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "privacy"
  | "joinMode"
  | "refundPolicy"
  | "createdAt"
  | "archivedAt"
> & {
  readonly access: "full";
  readonly joinQuestions: readonly JoinQuestion[];
  readonly coverUrl: string | null;
  readonly memberCount: number;
  readonly detailedDescription: ContentDocument | null;
};

export type CommunityPublicView = Pick<
  Community,
  "id" | "slug" | "name" | "description" | "privacy" | "joinMode" | "refundPolicy"
> & {
  readonly access: "limited";
  readonly joinQuestions: readonly JoinQuestion[];
  readonly coverUrl: string | null;
  readonly memberCount: number;
  readonly detailedDescription: ContentDocument | null;
};

export interface AboutPerson {
  readonly name: string;
  readonly image: string | null;
}

export interface AboutPeople {
  readonly owner: AboutPerson | null;
  readonly adminCount: number;
  readonly avatars: readonly AboutPerson[];
}

export interface AboutHostView {
  readonly bio: string | null;
  readonly credential: string | null;
}

export interface AboutContentView {
  readonly whatYouGet: readonly string[];
  readonly host: AboutHostView | null;
  readonly faq: readonly FaqItem[];
}

export interface AboutView extends AboutPeople {
  readonly gallery: readonly GalleryItemView[];
  readonly content: AboutContentView;
}

export function toAboutContent(
  community: Pick<Community, "whatYouGet" | "hostBio" | "hostCredential" | "faq">,
): AboutContentView {
  const { hostBio: bio, hostCredential: credential } = community;
  return {
    whatYouGet: community.whatYouGet ?? [],
    host: bio === null && credential === null ? null : { bio, credential },
    faq: community.faq ?? [],
  };
}

export type MembershipView = Pick<
  Membership,
  "id" | "communityId" | "userId" | "role" | "status" | "joinedAt"
>;

export interface CommunityWithMembership {
  community: CommunityView;
  membership: MembershipView;
}

export interface MemberListItem {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly role: MemberRole;
  readonly joinedAt: Date | null;
}

export type BrandingUrl = (key: string) => string;

function coverUrlOf(community: Community, brandingUrl: BrandingUrl): string | null {
  return community.appearance.coverKey ? brandingUrl(community.appearance.coverKey) : null;
}

export function toCommunityView(
  community: Community,
  memberCount: number,
  brandingUrl: BrandingUrl,
): CommunityView {
  return {
    access: "full",
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    privacy: community.privacy,
    joinMode: community.joinMode,
    refundPolicy: community.refundPolicy,
    joinQuestions: community.joinQuestions ?? [],
    coverUrl: coverUrlOf(community, brandingUrl),
    memberCount,
    detailedDescription: storedDetailedDescription(community.detailedDescription),
    createdAt: community.createdAt,
    archivedAt: community.archivedAt,
  };
}

export function toCommunityPublicView(
  community: Community,
  memberCount: number,
  brandingUrl: BrandingUrl,
): CommunityPublicView {
  return {
    access: "limited",
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    privacy: community.privacy,
    joinMode: community.joinMode,
    refundPolicy: community.refundPolicy,
    joinQuestions: community.joinQuestions ?? [],
    coverUrl: coverUrlOf(community, brandingUrl),
    memberCount,
    detailedDescription: storedDetailedDescription(community.detailedDescription),
  };
}

export function toMembershipView(membership: Membership): MembershipView {
  return {
    id: membership.id,
    communityId: membership.communityId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
  };
}

export function toCommunityWithMembership(
  row: CommunityMembership,
  memberCount: number,
  brandingUrl: BrandingUrl,
): CommunityWithMembership {
  return {
    community: toCommunityView(row.community, memberCount, brandingUrl),
    membership: toMembershipView(row.membership),
  };
}
