import {
  assertCan,
  can,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
} from "@cohory/authz";
import {
  communityIdSchema,
  communitySlugSchema,
  getDb,
  type Community,
  type Membership,
} from "@cohory/db";
import {
  canCreateCommunities,
  getPlatformConfig,
  type CommunityCreation,
} from "@cohory/config/platform";
import { noCommunityAccess, type CommunityAccess } from "@cohory/entitlements/access";
import {
  assertMemberCapacity,
  getFairUseConfig,
  resolveLimits,
  type FairUseConfig,
} from "@cohory/fair-use";
import { defaultUploadsRoute, getStorage, parseStorageKey } from "@cohory/storage";
import { z } from "zod";

import {
  ApprovalRequiredError,
  CommunityCreationRestrictedError,
  CommunityArchivedError,
  CommunityNotFoundError,
  CommunityValidationError,
  InviteOnlyError,
  MembershipNotFoundError,
  OwnerCannotLeaveError,
  PaymentRequiredError,
  SlugReservedError,
  SlugTakenError,
} from "./errors";
import { fairUseTier } from "./fair-use";
import { createPostgresCommunitiesRepository } from "./postgres-repository";
import type { CommunitiesRepository } from "./repository";
import { createCommunityInputSchema, reservedSlugs, type CreateCommunityInput } from "./schemas";
import { toGalleryView, type GalleryItemView } from "./gallery";
import {
  toCommunityPublicView,
  toAboutContent,
  toCommunityView,
  toCommunityWithMembership,
  toMembershipView,
  type AboutView,
  type CommunityPublicView,
  type CommunityView,
  type BrandingUrl,
  type CommunityWithMembership,
  type MemberListItem,
  type MembershipView,
} from "./views";

type UserActor = Extract<Actor, { kind: "user" }>;

export interface ViewerAccess extends CommunityAccess {
  readonly membership: MembershipView | null;
  readonly onboardingDismissed: boolean;
}

export interface CommunitiesService {
  createCommunity(actor: Actor, input: CreateCommunityInput): Promise<CommunityWithMembership>;
  getCommunityBySlug(actor: Actor, slug: string): Promise<CommunityView | CommunityPublicView>;
  findMovedSlug(formerSlug: string): Promise<string | null>;
  listCommunitiesForUser(actor: Actor): Promise<CommunityWithMembership[]>;
  joinCommunity(actor: Actor, communityId: string): Promise<MembershipView>;
  leaveCommunity(actor: Actor, communityId: string): Promise<MembershipView>;
  dismissOnboarding(actor: Actor, communityId: string): Promise<void>;
  getMembership(actor: Actor, communityId: string): Promise<MembershipView | null>;
  getAccess(actor: Actor, communityId: string): Promise<ViewerAccess>;
  searchMembersByName(
    actor: Actor,
    communityId: string,
    search: MemberNameSearch,
  ): Promise<MemberListItem[]>;
  getAbout(actor: Actor, communityId: string): Promise<AboutView>;
  listGallery(actor: Actor, communityId: string): Promise<GalleryItemView[]>;
}

export const aboutAvatarLimit = 8;

export const maxMemberNameSearchLimit = 50;

const memberNameSearchSchema = z.strictObject({
  prefix: z.string().trim().toLowerCase().min(1).max(64),
  limit: z.int().min(1).max(maxMemberNameSearchLimit),
});

export type MemberNameSearch = z.input<typeof memberNameSearchSchema>;

function requireUser(actor: Actor): UserActor {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor;
}

function activeRole(membership: Membership | null): CommunityRole | null {
  return membership?.status === "active" ? membership.role : null;
}

export interface CommunitiesServiceOptions {
  readonly brandingUrl?: BrandingUrl;
  readonly fairUse?: FairUseConfig;
  readonly communityCreation?: CommunityCreation;
}

function defaultBrandingUrl(key: string): string {
  return `${defaultUploadsRoute}/${key}`;
}

export function createCommunitiesService(
  repo: CommunitiesRepository,
  options: CommunitiesServiceOptions = {},
): CommunitiesService {
  const brandingUrl = options.brandingUrl ?? defaultBrandingUrl;
  const fairUse = () => options.fairUse ?? getFairUseConfig();
  const communityCreation = () =>
    options.communityCreation ?? getPlatformConfig().communityCreation;

  async function assertMayCreate(userId: string): Promise<void> {
    const creation = communityCreation();
    if (creation.mode === "anyone") return;
    const email = await repo.findConfirmedEmail(userId);
    if (!email || !canCreateCommunities(creation, email)) {
      throw new CommunityCreationRestrictedError();
    }
  }

  async function ensureVisible(
    actor: Actor,
    community: Community | null,
  ): Promise<{ community: Community; membership: Membership | null }> {
    if (!community) {
      throw new CommunityNotFoundError();
    }
    const membership =
      actor.kind === "user" ? await repo.findMembership(community.id, actor.userId) : null;
    const context = { role: activeRole(membership), communityPrivacy: community.privacy };
    if (!can(actor, "read", "community", context)) {
      throw new CommunityNotFoundError();
    }
    return { community, membership };
  }

  async function loadVisible(
    actor: Actor,
    communityId: string,
  ): Promise<{ community: Community; membership: Membership | null }> {
    const parsedId = communityIdSchema.safeParse(communityId);
    return ensureVisible(
      actor,
      parsedId.success ? await repo.findCommunityById(parsedId.data) : null,
    );
  }

  function accessOf(actor: Actor, community: Community): Promise<CommunityAccess> {
    return actor.kind === "user"
      ? repo.findAccess(community.id, actor.userId)
      : Promise.resolve(noCommunityAccess);
  }

  async function loadAbout(actor: Actor, communityId: string): Promise<Community> {
    const parsedId = communityIdSchema.safeParse(communityId);
    const community = parsedId.success ? await repo.findCommunityById(parsedId.data) : null;
    if (!community) {
      throw new CommunityNotFoundError();
    }
    const membership =
      actor.kind === "user" ? await repo.findMembership(community.id, actor.userId) : null;
    const context = { role: activeRole(membership), communityPrivacy: community.privacy };
    if (!can(actor, "read", "community", context) && community.privacy !== "private") {
      throw new CommunityNotFoundError();
    }
    return community;
  }

  return {
    async createCommunity(actor, input) {
      const user = requireUser(actor);
      assertCan(actor, "create", "community");
      await assertMayCreate(user.userId);
      const parsed = createCommunityInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new CommunityValidationError(
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      const { slug, name, description, privacy } = parsed.data;
      if (reservedSlugs.has(slug)) {
        throw new SlugReservedError(slug);
      }
      const result = await repo.createCommunityWithOwner({
        ownerUserId: user.userId,
        slug,
        name,
        description: description ?? null,
        privacy,
        joinMode: privacy === "private" ? "approval" : "open",
      });
      if (result.kind === "slug_taken") {
        throw new SlugTakenError(slug);
      }
      return toCommunityWithMembership(result, 1, brandingUrl);
    },

    async getCommunityBySlug(actor, slug) {
      const parsed = communitySlugSchema.safeParse(slug);
      const community = parsed.success ? await repo.findCommunityBySlug(parsed.data) : null;
      if (!community) {
        throw new CommunityNotFoundError();
      }
      const membership =
        actor.kind === "user" ? await repo.findMembership(community.id, actor.userId) : null;
      const context = { role: activeRole(membership), communityPrivacy: community.privacy };
      const memberCount = await repo.countActiveMembers(community.id);
      if (can(actor, "read", "community", context)) {
        return toCommunityView(community, memberCount, brandingUrl);
      }
      if (community.privacy === "private") {
        return toCommunityPublicView(community, memberCount, brandingUrl);
      }
      throw new CommunityNotFoundError();
    },

    async findMovedSlug(formerSlug) {
      const parsed = communitySlugSchema.safeParse(formerSlug);
      return parsed.success ? repo.findMovedCommunitySlug(parsed.data) : null;
    },

    async listCommunitiesForUser(actor) {
      const user = requireUser(actor);
      assertCan(actor, "read_own", "membership");
      const rows = await repo.listCommunitiesForUser(user.userId);
      const counts = await repo.countActiveMembersIn(rows.map((row) => row.community.id));
      return rows.map((row) =>
        toCommunityWithMembership(row, counts.get(row.community.id) ?? 0, brandingUrl),
      );
    },

    async joinCommunity(actor, communityId) {
      const user = requireUser(actor);
      const parsedId = communityIdSchema.safeParse(communityId);
      const community = parsedId.success ? await repo.findCommunityById(parsedId.data) : null;
      if (!community) {
        throw new CommunityNotFoundError();
      }
      const membership = await repo.findMembership(community.id, user.userId);
      if (membership?.status === "active") {
        return toMembershipView(membership);
      }
      if (membership?.status === "banned") {
        throw new ForbiddenError("join", "membership");
      }
      assertCan(actor, "join", "membership", { role: null, communityPrivacy: community.privacy });
      if (community.archivedAt) {
        throw new CommunityArchivedError();
      }
      if (community.currency !== null) {
        throw new PaymentRequiredError();
      }
      if (community.joinMode === "approval") {
        throw new ApprovalRequiredError();
      }
      if (community.joinMode === "invite") {
        throw new InviteOnlyError();
      }
      if (await repo.isEmailBanned(community.id, user.userId)) {
        throw new ForbiddenError("join", "membership");
      }
      const limits = await resolveLimits(fairUse(), ["members"], () =>
        fairUseTier((since) => repo.hasPaidTransactionSince(community.id, since), new Date()),
      );
      if (limits.members !== null) {
        assertMemberCapacity(limits, await repo.countActiveMembers(community.id));
      }
      const joinedAt = new Date();
      if (membership) {
        const reactivated = await repo.setMembershipStatus(
          community.id,
          user.userId,
          "active",
          joinedAt,
        );
        if (!reactivated) {
          throw new MembershipNotFoundError();
        }
        return toMembershipView(reactivated);
      }
      const { membership: created } = await repo.insertMembershipIfAbsent(community.id, {
        userId: user.userId,
        role: "member",
        status: "active",
        joinedAt,
      });
      return toMembershipView(created);
    },

    async leaveCommunity(actor, communityId) {
      const user = requireUser(actor);
      const { community, membership } = await loadVisible(actor, communityId);
      const role = activeRole(membership);
      if (!role) {
        throw new MembershipNotFoundError();
      }
      if (role === "owner") {
        throw new OwnerCannotLeaveError();
      }
      assertCan(actor, "leave", "membership", { role, communityPrivacy: community.privacy });
      const left = await repo.leaveMembership(community.id, user.userId);
      if (!left) {
        throw new MembershipNotFoundError();
      }
      return toMembershipView(left);
    },

    async dismissOnboarding(actor, communityId) {
      const user = requireUser(actor);
      const { community, membership } = await loadVisible(actor, communityId);
      const role = activeRole(membership);
      if (!role) {
        throw new MembershipNotFoundError();
      }
      assertCan(actor, "update_own_profile", "membership", {
        role,
        communityPrivacy: community.privacy,
      });
      await repo.dismissOnboarding(community.id, user.userId, new Date());
    },

    async getMembership(actor, communityId) {
      requireUser(actor);
      const { community, membership } = await loadVisible(actor, communityId);
      assertCan(actor, "read_own", "membership", {
        role: activeRole(membership),
        communityPrivacy: community.privacy,
      });
      return membership ? toMembershipView(membership) : null;
    },

    async getAccess(actor, communityId) {
      const { community, membership } = await loadVisible(actor, communityId);
      const access = await accessOf(actor, community);
      return {
        ...access,
        membership: membership ? toMembershipView(membership) : null,
        onboardingDismissed: (membership?.onboardingDismissedAt ?? null) !== null,
      };
    },

    async searchMembersByName(actor, communityId, search) {
      const parsed = memberNameSearchSchema.safeParse(search);
      if (!parsed.success) {
        throw new CommunityValidationError(
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      const { community } = await loadVisible(actor, communityId);
      const { role, entitled } = await accessOf(actor, community);
      assertCan(actor, "list", "membership", {
        role,
        communityPrivacy: community.privacy,
        entitled,
      });
      return repo.searchActiveMembers(community.id, parsed.data);
    },

    async getAbout(actor, communityId) {
      const community = await loadAbout(actor, communityId);
      const [gallery, people] = await Promise.all([
        repo.listGallery(community.id),
        repo.aboutPeople(community.id, aboutAvatarLimit),
      ]);
      return {
        ...people,
        gallery: toGalleryView(gallery, brandingUrl),
        content: toAboutContent(community),
      };
    },

    async listGallery(actor, communityId) {
      const community = await loadAbout(actor, communityId);
      return toGalleryView(await repo.listGallery(community.id), brandingUrl);
    },
  };
}

let defaultService: CommunitiesService | undefined;

export function getCommunitiesService(): CommunitiesService {
  defaultService ??= createCommunitiesService(createPostgresCommunitiesRepository(getDb()), {
    brandingUrl: (key) => getStorage().publicUrl(parseStorageKey(key)),
  });
  return defaultService;
}
