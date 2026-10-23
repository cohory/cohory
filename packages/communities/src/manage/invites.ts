import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { assertMemberCapacity, resolveLimits } from "@cohory/fair-use";
import { z } from "zod";

import {
  CommunityValidationError,
  InviteNotFoundError,
  InviteUnavailableError,
  PaymentRequiredError,
} from "../errors";
import { fairUseTier } from "../fair-use";
import { inManagedCommunity, parseInput, requireUser, type Runtime } from "./context";
import { createInviteInputSchema, inviteTokenSchema, type CreateInviteInput } from "./schemas";
import { openJoinRequest } from "./joining";
import { activate, membershipView } from "./membership";
import { assertNotArchived } from "./settings";
import {
  inviteStatus,
  toInviteLinkView,
  toJoinRequestStatusView,
  type InviteLinkView,
  type InvitePreview,
  type RedeemedInvite,
} from "./views";

export const membershipHoldMs = 24 * 60 * 60 * 1000;

export function inviteOperations(runtime: Runtime) {
  return {
    createInviteLink(
      actor: Actor,
      communityId: string,
      input: CreateInviteInput = {},
    ): Promise<InviteLinkView> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "invite", managed.context);
        assertNotArchived(managed.community);
        const parsed = parseInput(createInviteInputSchema, input);
        const now = runtime.now();
        if (parsed.expiresAt && parsed.expiresAt <= now) {
          throw new CommunityValidationError([
            { path: "expiresAt", message: "Choose an expiry date in the future." },
          ]);
        }
        await managed.store.enableManagement();
        const invite = await managed.store.insertInvite({
          token: runtime.newToken(),
          createdBy: managed.user.userId,
          expiresAt: parsed.expiresAt ?? null,
          maxUses: parsed.maxUses ?? null,
          requiresApproval: parsed.requiresApproval ?? false,
          label: parsed.label ?? null,
        });
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "invite.created",
          target: invite.id,
          metadata: {
            expiresAt: invite.expiresAt?.toISOString() ?? null,
            maxUses: invite.maxUses,
            requiresApproval: invite.requiresApproval,
            labeled: invite.label !== null,
          },
        });
        return toInviteLinkView(invite, now);
      });
    },

    listInviteLinks(actor: Actor, communityId: string): Promise<InviteLinkView[]> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "invite", managed.context);
        await managed.store.enableManagement();
        const now = runtime.now();
        return (await managed.store.listInvites()).map((invite) => toInviteLinkView(invite, now));
      });
    },

    revokeInviteLink(actor: Actor, communityId: string, inviteId: string): Promise<InviteLinkView> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "invite", managed.context);
        if (!z.uuid().safeParse(inviteId).success) {
          throw new InviteNotFoundError();
        }
        await managed.store.enableManagement();
        const now = runtime.now();
        const invite = await managed.store.revokeInvite(inviteId, now);
        if (!invite) {
          throw new InviteNotFoundError();
        }
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "invite.revoked",
          target: invite.id,
        });
        return toInviteLinkView(invite, now);
      });
    },

    async previewInvite(token: string): Promise<InvitePreview | null> {
      if (!inviteTokenSchema.safeParse(token).success) {
        return null;
      }
      const lookup = await runtime.repo.findInviteByToken(token);
      if (!lookup) {
        return null;
      }
      const community = await runtime.repo.findCommunity(lookup.communityId);
      if (!community || community.deletedAt) {
        return null;
      }
      return {
        community: { slug: community.slug, name: community.name },
        status: community.archivedAt ? "archived" : inviteStatus(lookup.invite, runtime.now()),
      };
    },

    async redeemInvite(actor: Actor, token: string): Promise<RedeemedInvite> {
      const user = requireUser(actor);
      if (!inviteTokenSchema.safeParse(token).success) {
        throw new InviteUnavailableError();
      }
      const lookup = await runtime.repo.findInviteByToken(token);
      if (!lookup) {
        throw new InviteUnavailableError();
      }
      const redeemed = await runtime.repo.inCommunity(
        lookup.communityId,
        { userId: user.userId, inviteToken: token },
        async (store): Promise<RedeemedInvite | "payment_required"> => {
          const community = await store.findCommunity();
          if (!community || community.deletedAt) {
            throw new InviteUnavailableError();
          }
          assertNotArchived(community);
          const summary = { id: community.id, slug: community.slug, name: community.name };
          const existing = await store.findMember(user.userId);
          if (existing?.status === "active") {
            return { community: summary, membership: membershipView(existing), request: null };
          }
          if (existing?.status === "banned") {
            throw new ForbiddenError("join", "membership");
          }
          const email = await store.findUserEmail(user.userId);
          if (email && (await store.isEmailBanned(email))) {
            throw new ForbiddenError("join", "membership");
          }
          const now = runtime.now();
          if (community.currency !== null) {
            if (existing?.status !== "pending") {
              if (
                !(await store.holdMembership(user.userId, {
                  inviteId: lookup.id,
                  expiresAt: new Date(now.getTime() + membershipHoldMs),
                })) ||
                !(await store.consumeInvite(lookup.id, now))
              ) {
                throw new InviteUnavailableError();
              }
              await store.appendAudit({
                actorId: user.userId,
                action: "invite.redeemed",
                target: lookup.id,
              });
            }
            return "payment_required";
          }
          const limits = await resolveLimits(runtime.fairUse(), ["members"], () =>
            fairUseTier((since) => store.hasPaidTransactionSince(since), now),
          );
          if (limits.members !== null) {
            assertMemberCapacity(limits, await store.countActiveMembers());
          }
          if (lookup.invite.requiresApproval) {
            const pending = await store.findLatestJoinRequest(user.userId);
            if (pending?.status === "pending") {
              return {
                community: summary,
                membership: null,
                request: toJoinRequestStatusView(pending),
              };
            }
            if (!(await store.consumeInvite(lookup.id, now))) {
              throw new InviteUnavailableError();
            }
            const request = await openJoinRequest(store, user.userId, []);
            await store.appendAudit({
              actorId: user.userId,
              action: "invite.redeemed",
              target: lookup.id,
            });
            return {
              community: summary,
              membership: null,
              request: toJoinRequestStatusView(request),
            };
          }
          const { membership, joined } = await activate(store, user.userId, existing, now);
          if (joined) {
            if (!(await store.consumeInvite(lookup.id, now))) {
              throw new InviteUnavailableError();
            }
            await store.appendAudit({
              actorId: user.userId,
              action: "invite.redeemed",
              target: lookup.id,
            });
          }
          return { community: summary, membership: membershipView(membership), request: null };
        },
      );
      if (redeemed === "payment_required") {
        throw new PaymentRequiredError();
      }
      return redeemed;
    },
  };
}
