import {
  newId,
  parseCommunityId,
  type Community,
  type CommunityId,
  type Membership,
} from "@cohory/db";
import { communityAccessFrom } from "@cohory/entitlements/access";

import type { CommunityGalleryItem } from "@cohory/db/schema";

import type { CommunitiesRepository } from "../repository";

export function createFakeRepository(): CommunitiesRepository & {
  addCommunity(overrides: Partial<Community> & Pick<Community, "slug">): Community;
  addMembership(
    overrides: Partial<Membership> & Pick<Membership, "communityId" | "userId">,
  ): Membership;
  addUser(
    userId: string,
    name: string,
    image?: string,
    email?: string,
    emailVerified?: boolean,
  ): void;
  addPaidTransaction(communityId: CommunityId, occurredAt: Date): void;
  addFormerSlug(formerSlug: string, communityId: CommunityId): void;
  addGalleryItem(
    overrides: Partial<CommunityGalleryItem> & Pick<CommunityGalleryItem, "communityId">,
  ): CommunityGalleryItem;
} {
  const gallery: CommunityGalleryItem[] = [];
  const paidTransactions: { communityId: CommunityId; occurredAt: Date }[] = [];
  const communities = new Map<CommunityId, Community>();
  const formerSlugs = new Map<string, CommunityId>();
  const memberships: Membership[] = [];
  const users = new Map<
    string,
    { name: string; image: string | null; email: string | null; emailVerified: boolean }
  >();
  const roleOrder = ["owner", "admin", "moderator", "member"] as const;

  function buildCommunity(overrides: Partial<Community> & Pick<Community, "slug">): Community {
    const now = new Date();
    return {
      id: parseCommunityId(newId()),
      name: "Community",
      description: null,
      privacy: "private",
      joinMode: "open",
      joinQuestions: null,
      appearance: {},
      appearanceTokens: null,
      gamificationEnabled: true,
      reviewsEnabled: false,
      levelNames: [],
      currency: null,
      slugChangedAt: null,
      whatYouGet: null,
      hostBio: null,
      hostCredential: null,
      faq: null,
      setupChecklistHiddenAt: null,
      setupImportSkippedAt: null,
      aboutPreviewedAt: null,
      inviteLinkCopiedAt: null,
      testCheckoutSucceededAt: null,
      refundPolicy: null,
      pointsForLessons: false,
      pointsForEvents: false,
      memberEmailSentAt: null,
      memberEmailSentBy: null,
      archivedAt: null,
      deletedAt: null,
      purgeAttemptedAt: null,
      detailedDescription: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function buildMembership(
    overrides: Partial<Membership> & Pick<Membership, "communityId" | "userId">,
  ): Membership {
    const now = new Date();
    return {
      id: newId(),
      role: "member",
      status: "active",
      joinAnswers: null,
      bio: null,
      bannedEmail: null,
      removalReason: null,
      joinedAt: now,
      lastSeenAt: null,
      lastFeedVisitAt: null,
      onboardingDismissedAt: null,
      welcomeEmailSentAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function find(communityId: string, userId: string): Membership | undefined {
    return memberships.find((m) => m.communityId === communityId && m.userId === userId);
  }

  return {
    addCommunity(overrides) {
      const community = buildCommunity(overrides);
      communities.set(community.id, community);
      return community;
    },
    addUser(userId, name, image, email, emailVerified = true) {
      users.set(userId, { name, image: image ?? null, email: email ?? null, emailVerified });
    },
    addMembership(overrides) {
      const membership = buildMembership(overrides);
      memberships.push(membership);
      return membership;
    },
    async createCommunityWithOwner({ ownerUserId, ...input }) {
      const taken = [...communities.values()].some(
        (c) => c.slug.toLowerCase() === input.slug.toLowerCase(),
      );
      if (taken) {
        return { kind: "slug_taken" };
      }
      const community = buildCommunity(input);
      communities.set(community.id, community);
      const membership = buildMembership({
        communityId: community.id,
        userId: ownerUserId,
        role: "owner",
      });
      memberships.push(membership);
      return { kind: "created", community, membership };
    },
    async findCommunityBySlug(slug) {
      return [...communities.values()].find((c) => c.slug === slug && !c.deletedAt) ?? null;
    },
    async findMovedCommunitySlug(formerSlug) {
      const communityId = formerSlugs.get(formerSlug);
      const community = communityId ? communities.get(communityId) : undefined;
      return community && !community.deletedAt && community.slug !== formerSlug
        ? community.slug
        : null;
    },
    addFormerSlug(formerSlug, communityId) {
      formerSlugs.set(formerSlug, communityId);
    },
    async findCommunityById(id) {
      const community = communities.get(id);
      return community && !community.deletedAt ? community : null;
    },
    async findConfirmedEmail(userId) {
      const found = users.get(userId);
      return found?.emailVerified ? found.email : null;
    },
    async findMembership(communityId, userId) {
      return find(communityId, userId) ?? null;
    },
    async findAccess(communityId, userId) {
      return communityAccessFrom({
        membership: find(communityId, userId) ?? null,
        subscription: null,
        comp: null,
        paidPlanActive: false,
        now: new Date(),
      });
    },
    async insertMembershipIfAbsent(communityId, input) {
      const existing = find(communityId, input.userId);
      if (existing) {
        return { membership: existing, created: false };
      }
      const membership = buildMembership({ ...input, communityId });
      memberships.push(membership);
      return { membership, created: true };
    },
    async setMembershipStatus(communityId, userId, status, joinedAt) {
      const existing = find(communityId, userId);
      if (!existing) {
        return null;
      }
      existing.status = status;
      existing.removalReason = null;
      if (joinedAt) {
        existing.joinedAt = joinedAt;
      }
      return existing;
    },
    async leaveMembership(communityId, userId) {
      const existing = find(communityId, userId);
      if (!existing) {
        return null;
      }
      existing.status = "removed";
      existing.removalReason = "left";
      return existing;
    },
    async dismissOnboarding(communityId, userId, at) {
      const existing = find(communityId, userId);
      if (existing && existing.onboardingDismissedAt === null) {
        existing.onboardingDismissedAt = at;
      }
    },
    async listCommunitiesForUser(userId) {
      return memberships
        .filter((m) => m.userId === userId && m.status === "active")
        .flatMap((membership) => {
          const community = communities.get(parseCommunityId(membership.communityId));
          return community ? [{ community, membership }] : [];
        });
    },
    async hasPaidTransactionSince(communityId, since) {
      return paidTransactions.some(
        (row) => row.communityId === communityId && row.occurredAt >= since,
      );
    },
    addPaidTransaction(communityId, occurredAt) {
      paidTransactions.push({ communityId, occurredAt });
    },
    async isEmailBanned(communityId, userId) {
      const email = users.get(userId)?.email;
      return memberships.some(
        (m) =>
          m.communityId === communityId &&
          m.status === "banned" &&
          email !== null &&
          email !== undefined &&
          m.bannedEmail?.toLowerCase() === email.toLowerCase(),
      );
    },
    async countActiveMembers(communityId) {
      return memberships.filter((m) => m.communityId === communityId && m.status === "active")
        .length;
    },
    async countActiveMembersIn(communityIds) {
      return new Map(
        communityIds.map((id) => [
          id,
          memberships.filter((m) => m.communityId === id && m.status === "active").length,
        ]),
      );
    },
    addGalleryItem(overrides) {
      const now = new Date();
      const item: CommunityGalleryItem = {
        id: newId(),
        kind: "image",
        storageKey: null,
        embedUrl: null,
        thumbnailUrl: null,
        position: gallery.filter((row) => row.communityId === overrides.communityId).length,
        altText: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
      gallery.push(item);
      return item;
    },
    async listGallery(communityId) {
      return gallery
        .filter((item) => item.communityId === communityId)
        .sort((a, b) => a.position - b.position);
    },
    async aboutPeople(communityId, avatarLimit) {
      const active = memberships.filter(
        (m) => m.communityId === communityId && m.status === "active",
      );
      const person = (m: Membership) => ({
        name: users.get(m.userId)?.name ?? "Person",
        image: users.get(m.userId)?.image ?? null,
      });
      const owner = active.find((m) => m.role === "owner");
      return {
        owner: owner ? person(owner) : null,
        adminCount: active.filter((m) => m.role === "owner" || m.role === "admin").length,
        avatars: active.slice(0, avatarLimit).map(person),
      };
    },
    async searchActiveMembers(communityId, search) {
      const nameOf = (userId: string) => users.get(userId)?.name ?? "Person";
      return memberships
        .filter(
          (m) =>
            m.communityId === communityId &&
            m.status === "active" &&
            nameOf(m.userId)
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]/gu, "")
              .startsWith(search.prefix),
        )
        .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
        .slice(0, search.limit)
        .map((m) => ({
          userId: m.userId,
          name: users.get(m.userId)?.name ?? "Person",
          image: users.get(m.userId)?.image ?? null,
          role: m.role,
          joinedAt: m.joinedAt,
        }));
    },
  };
}
