import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { communityIdSchema, type CommunityId } from "@cohory/db";
import { z } from "zod";

import { hasAccess, resolveMembershipAccess } from "../access";
import {
  compExpiryBatch,
  compListLimit,
  grantCompInputSchema,
  type GrantCompInput,
} from "../comps/schemas";
import type { CompInvitationRecord, CompRecord } from "../comps/store";
import {
  toCompInvitationView,
  toCompListItem,
  toCompView,
  type CompInvitationListItem,
  type CompListItem,
  type CompView,
  type GrantCompResult,
  type MyCompInvitations,
} from "../comps/views";
import {
  CompAlreadyGrantedError,
  PaymentsNotFoundError,
  PaymentsValidationError,
  PlanUnavailableError,
} from "../errors";
import type { MemberRecord, PaymentsStore } from "../repository";
import { parse, requireUserId, withAccess, type Runtime } from "./context";

export interface CompExpiryResult {
  readonly expired: number;
}

export interface CompOperations {
  grantComp(actor: Actor, communityId: string, input: GrantCompInput): Promise<GrantCompResult>;
  revokeComp(actor: Actor, communityId: string, compId: string): Promise<CompView>;
  listComps(actor: Actor, communityId: string): Promise<CompListItem[]>;
  listCompInvitations(actor: Actor, communityId: string): Promise<CompInvitationListItem[]>;
  withdrawCompInvitation(
    actor: Actor,
    communityId: string,
    invitationId: string,
  ): Promise<CompInvitationListItem>;
  listMyCompInvitations(actor: Actor, communityId: string): Promise<MyCompInvitations>;
  acceptCompInvitation(actor: Actor, communityId: string, invitationId: string): Promise<CompView>;
  expireComps(): Promise<CompExpiryResult>;
}

function inCommunity(member: MemberRecord | null): boolean {
  return (
    member?.status === "active" || (member?.status === "removed" && member.removalReason === "left")
  );
}

function isOpenOffer(invitation: CompInvitationRecord, now: Date): boolean {
  return invitation.expiresAt === null || invitation.expiresAt > now;
}

async function shouldRemoveMembership(
  store: PaymentsStore,
  userId: string,
  now: Date,
): Promise<boolean> {
  const [member, subscription, comp, plan] = await Promise.all([
    store.findMember(userId),
    store.findSubscriptionForUser(userId),
    store.comps.findOpen(userId),
    store.findActivePlan(),
  ]);
  if (member?.status !== "active" || member.role !== "member" || !plan) {
    return false;
  }
  const connectionClosedAt = subscription
    ? await store.findConnectionClosedAt(subscription.connectionId)
    : null;
  return !hasAccess(
    resolveMembershipAccess({
      paidPlanActive: true,
      membership: null,
      subscription: subscription ? { ...subscription, connectionClosedAt } : null,
      comp,
      now,
    }),
  );
}

export function createCompOperations(runtime: Runtime): CompOperations {
  const { repo } = runtime;

  async function finish(
    communityId: CommunityId,
    comp: CompRecord,
    removeMembership: boolean,
  ): Promise<void> {
    if (removeMembership) {
      await repo.removeMembership(communityId, comp.userId);
    }
  }

  return {
    async grantComp(actor, communityId, input) {
      const actorId = requireUserId(actor);
      const parsed = parse(grantCompInputSchema, input);
      const now = runtime.now();
      if (parsed.expiresAt && parsed.expiresAt <= now) {
        throw new PaymentsValidationError([
          { path: "expiresAt", message: "Choose an end date in the future." },
        ]);
      }
      const cloud = runtime.env.edition === "cloud";
      const outcome = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, context, community }) => {
          assertCan(actor, "grant_comp", "membership", context);
          await store.enableManagement();
          if (!(await store.findActivePlan())) {
            throw new PlanUnavailableError();
          }
          const note = parsed.note ? parsed.note : null;
          if (cloud && parsed.email) {
            const email = parsed.email;
            const inserted = await store.comps.invitations.insert({
              email,
              grantedBy: actorId,
              note,
              expiresAt: parsed.expiresAt ?? null,
            });
            if (inserted) {
              await store.comps.appendAudit({
                actorId,
                action: "comp.invited",
                target: inserted.id,
                metadata: {
                  invitationId: inserted.id,
                  expiresAt: inserted.expiresAt?.toISOString() ?? null,
                  note: inserted.note !== null,
                },
              });
            }
            const invitation = inserted ?? (await store.comps.invitations.findOpenByEmail(email));
            if (!invitation) {
              throw new CompAlreadyGrantedError();
            }
            return { kind: "invited" as const, invitation };
          }
          const userId = parsed.userId ?? (await store.comps.findUserIdByEmail(parsed.email ?? ""));
          if (!userId || (parsed.userId && !(await store.findUserEmail(parsed.userId)))) {
            throw new PaymentsNotFoundError("person");
          }
          const member = await store.findMember(userId);
          if (member?.status === "banned") {
            throw new ForbiddenError("grant_comp", "membership");
          }
          if (cloud && !inCommunity(member)) {
            throw new PaymentsNotFoundError("person");
          }
          const inserted = await store.comps.insert({
            userId,
            grantedBy: actorId,
            note,
            expiresAt: parsed.expiresAt ?? null,
          });
          if (!inserted) {
            throw new CompAlreadyGrantedError();
          }
          await store.comps.appendAudit({
            actorId,
            action: "comp.granted",
            target: userId,
            metadata: {
              compId: inserted.id,
              expiresAt: inserted.expiresAt?.toISOString() ?? null,
              note: inserted.note !== null,
            },
          });
          return { kind: "granted" as const, comp: inserted, community };
        },
      );
      if (outcome.kind === "invited") {
        return { kind: "invited", invitation: toCompInvitationView(outcome.invitation) };
      }
      await repo.activateMembership(outcome.community.id, outcome.comp.userId, now);
      return { kind: "granted", comp: toCompView(outcome.comp, now) };
    },

    async listCompInvitations(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        return (await store.comps.invitations.listOpen(compListLimit)).map((row) => ({
          ...toCompInvitationView(row.invitation),
          grantedByName: row.grantedByName,
        }));
      });
    },

    async withdrawCompInvitation(actor, communityId, invitationId) {
      const actorId = requireUserId(actor);
      const now = runtime.now();
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "grant_comp", "membership", context);
        await store.enableManagement();
        const withdrawn = z.uuid().safeParse(invitationId).success
          ? await store.comps.invitations.withdraw(invitationId, { by: actorId, at: now })
          : null;
        if (!withdrawn) {
          throw new PaymentsNotFoundError("comp");
        }
        await store.comps.appendAudit({
          actorId,
          action: "comp.invitation_withdrawn",
          target: withdrawn.id,
          metadata: { invitationId: withdrawn.id },
        });
        return { ...toCompInvitationView(withdrawn), grantedByName: null };
      });
    },

    async listMyCompInvitations(actor, communityId) {
      const userId = requireUserId(actor);
      const none: MyCompInvitations = { invitations: [], waitingForVerification: false };
      const { community, banned } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ community, member, context }) => {
          assertCan(actor, "read_own", "payment", context);
          return { community, banned: member?.status === "banned" };
        },
      );
      if (banned) {
        return none;
      }
      const now = runtime.now();
      return runtime.repo.inCommunityAsSystem(community.id, async (store) => {
        const identity = await store.links.findIdentity(userId);
        const invitation = identity
          ? await store.comps.invitations.findOpenByEmail(identity.email)
          : null;
        if (!identity || !invitation || !isOpenOffer(invitation, now)) {
          return none;
        }
        if (!identity.emailVerified) {
          return { invitations: [], waitingForVerification: true };
        }
        return {
          invitations: [{ id: invitation.id, expiresAt: invitation.expiresAt }],
          waitingForVerification: false,
        };
      });
    },

    async acceptCompInvitation(actor, communityId, invitationId) {
      const userId = requireUserId(actor);
      const now = runtime.now();
      const { community, banned } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ community, member, context }) => {
          assertCan(actor, "read_own", "payment", context);
          return { community, banned: member?.status === "banned" };
        },
      );
      if (banned) {
        throw new ForbiddenError("accept_comp", "membership");
      }
      if (!z.uuid().safeParse(invitationId).success) {
        throw new PaymentsNotFoundError("comp");
      }
      const comp = await runtime.repo.inCommunityAsSystem(community.id, async (store) => {
        const identity = await store.links.findIdentity(userId);
        const invitation = await store.comps.invitations.findOpen(invitationId);
        if (
          !identity?.emailVerified ||
          !invitation ||
          invitation.email.toLowerCase() !== identity.email.toLowerCase() ||
          !isOpenOffer(invitation, now)
        ) {
          throw new PaymentsNotFoundError("comp");
        }
        if (!(await store.findActivePlan())) {
          throw new PlanUnavailableError();
        }
        const granted =
          (await store.comps.insert({
            userId,
            grantedBy: invitation.grantedBy,
            note: invitation.note,
            expiresAt: invitation.expiresAt,
          })) ?? (await store.comps.findOpen(userId));
        if (!granted) {
          throw new CompAlreadyGrantedError();
        }
        await store.comps.invitations.accept(invitation.id, {
          userId,
          compId: granted.id,
          at: now,
        });
        await store.comps.appendAudit({
          actorId: userId,
          action: "comp.accepted",
          target: userId,
          metadata: { compId: granted.id, invitationId: invitation.id },
        });
        return granted;
      });
      await repo.activateMembership(community.id, userId, now);
      return toCompView(comp, now);
    },

    async revokeComp(actor, communityId, compId) {
      const actorId = requireUserId(actor);
      const now = runtime.now();
      const { comp, community, remove } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, context, community }) => {
          assertCan(actor, "grant_comp", "membership", context);
          await store.enableManagement();
          const ended = z.uuid().safeParse(compId).success
            ? await store.comps.end(compId, { reason: "revoked", endedBy: actorId, at: now })
            : null;
          if (!ended) {
            throw new PaymentsNotFoundError("comp");
          }
          await store.comps.appendAudit({
            actorId,
            action: "comp.revoked",
            target: ended.userId,
            metadata: { compId: ended.id },
          });
          return {
            comp: ended,
            community,
            remove: await shouldRemoveMembership(store, ended.userId, now),
          };
        },
      );
      await finish(community.id, comp, remove);
      return toCompView(comp, now);
    },

    async listComps(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        const now = runtime.now();
        return (await store.comps.listOpen(compListLimit)).map((row) => toCompListItem(row, now));
      });
    },

    async expireComps() {
      const now = runtime.now();
      const due = await repo.listDueComps(now, compExpiryBatch);
      let expired = 0;
      for (const item of due) {
        const communityId = communityIdSchema.parse(item.communityId);
        const outcome = await repo.inCommunityAsSystem(communityId, async (store) => {
          const ended = await store.comps.end(item.id, {
            reason: "expired",
            endedBy: null,
            at: now,
          });
          if (!ended) {
            return null;
          }
          await store.comps.appendAudit({
            actorId: null,
            action: "comp.expired",
            target: ended.userId,
            metadata: { compId: ended.id },
          });
          return { comp: ended, remove: await shouldRemoveMembership(store, ended.userId, now) };
        });
        if (outcome) {
          await finish(communityId, outcome.comp, outcome.remove);
          expired += 1;
        }
      }
      if (expired > 0) {
        runtime.log({ msg: "comped access expired", expired });
      }
      return { expired };
    },
  };
}
