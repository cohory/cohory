import {
  communitySlugSchema,
  getCommunityBySlug,
  isUniqueViolation,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
} from "@cohory/db";
import { communities, memberships, users } from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import type { ManageRepository } from "../manage/repository";
import type { CreatorsInviteStore } from "./service";

async function ownerOf(
  db: Database,
  communityId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await runInCommunity(
    withCommunity(db, parseCommunityId(communityId)),
    ({ tx, where }) =>
      tx
        .select({ id: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where(memberships, eq(memberships.role, "owner"), eq(memberships.status, "active")))
        .limit(1),
  );
  return row ?? null;
}

export function createPostgresCreatorsInviteStore(
  db: Database,
  repo: ManageRepository,
): CreatorsInviteStore {
  return {
    async findCreatorsCommunity(slug) {
      const parsed = communitySlugSchema.safeParse(slug);
      const community = parsed.success ? await getCommunityBySlug(db, parsed.data) : null;
      if (!community) {
        return null;
      }
      const owner = await ownerOf(db, community.id);
      return {
        id: community.id,
        slug: community.slug,
        name: community.name,
        ownerId: owner?.id ?? null,
        ownerName: owner?.name ?? null,
        archived: community.archivedAt !== null,
      };
    },

    async findCreatedCommunity(communityId) {
      const [community] = await db
        .select({ id: communities.id, createdAt: communities.createdAt })
        .from(communities)
        .where(and(eq(communities.id, communityId), isNull(communities.deletedAt)))
        .limit(1);
      if (!community) {
        return null;
      }
      return { ...community, ownerId: (await ownerOf(db, community.id))?.id ?? null };
    },

    async findCreator(userId) {
      const [row] = await db
        .select({
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          erasedAt: users.erasedAt,
          deletionScheduledFor: users.deletionScheduledFor,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!row) {
        return null;
      }
      return {
        name: row.name,
        email: row.email,
        emailVerified: row.emailVerified,
        closing: row.erasedAt !== null || row.deletionScheduledFor !== null,
      };
    },

    findMembership(communityId, userId, email) {
      return repo.inCommunity(parseCommunityId(communityId), { userId }, async (store) => {
        const member = await store.findMember(userId);
        if (member?.status === "banned" || (await store.isEmailBanned(email))) {
          return "banned";
        }
        if (member?.status === "active") {
          return "active";
        }
        return member ? "other" : null;
      });
    },

    async inviteExists(token) {
      return (await repo.findInviteByToken(token)) !== null;
    },

    async insertInvite(communityId, invite, deliver) {
      try {
        await repo.inCommunity(
          parseCommunityId(communityId),
          { userId: invite.createdBy },
          async (store) => {
            await store.enableManagement();
            const created = await store.insertInvite({
              token: invite.token,
              createdBy: invite.createdBy,
              expiresAt: invite.expiresAt,
              maxUses: 1,
              requiresApproval: false,
              label: invite.label,
            });
            await store.appendAudit({
              actorId: invite.createdBy,
              action: "invite.created",
              target: created.id,
              metadata: {
                expiresAt: invite.expiresAt.toISOString(),
                maxUses: 1,
                requiresApproval: false,
                labeled: true,
                automatic: "creators_invite",
              },
            });
            await deliver();
          },
        );
        return true;
      } catch (error: unknown) {
        if (isUniqueViolation(error, "invite_links_token_unique")) {
          return false;
        }
        throw error;
      }
    },
  };
}
