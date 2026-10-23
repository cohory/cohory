import { createHmac } from "node:crypto";

import { z } from "zod";

export const creatorsInviteTriggers = ["created", "post", "course"] as const;

export type CreatorsInviteTrigger = (typeof creatorsInviteTriggers)[number];

export const creatorsInviteInputSchema = z.strictObject({
  communityId: z.uuid(),
  trigger: z.enum(creatorsInviteTriggers),
});

export type CreatorsInviteInput = z.infer<typeof creatorsInviteInputSchema>;

export const creatorsInviteDelayDays = 3;
export const creatorsInviteLifetimeDays = 30;
export const creatorsInviteLabel = "Sent automatically to a new creator";

const dayMs = 24 * 60 * 60 * 1000;

export type CreatorsInviteOutcome =
  | "sent"
  | "disabled"
  | "creators_unavailable"
  | "creators_community"
  | "community_unavailable"
  | "not_due"
  | "creators_owner"
  | "already_invited"
  | "member"
  | "banned"
  | "unconfirmed"
  | "account_closing"
  | "opted_out";

export interface CreatorsCommunityFacts {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly archived: boolean;
}

export interface CreatedCommunityFacts {
  readonly id: string;
  readonly createdAt: Date;
  readonly ownerId: string | null;
}

export interface CreatorFacts {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly closing: boolean;
}

export type CreatorsMembership = "active" | "banned" | "other" | null;

export interface NewCreatorsInvite {
  readonly token: string;
  readonly createdBy: string;
  readonly expiresAt: Date;
  readonly label: string;
}

export interface CreatorsInviteStore {
  findCreatorsCommunity(slug: string): Promise<CreatorsCommunityFacts | null>;
  findCreatedCommunity(communityId: string): Promise<CreatedCommunityFacts | null>;
  findCreator(userId: string): Promise<CreatorFacts | null>;
  findMembership(communityId: string, userId: string, email: string): Promise<CreatorsMembership>;
  inviteExists(token: string): Promise<boolean>;
  // Runs `deliver` inside the transaction that stores the invite, so a failed send leaves no
  // invite behind and the job can retry. Returns false when the token already exists.
  insertInvite(
    communityId: string,
    invite: NewCreatorsInvite,
    deliver: () => Promise<void>,
  ): Promise<boolean>;
}

export interface CreatorsInviteMessage {
  readonly to: string;
  readonly name: string;
  readonly inviterName: string | null;
  readonly community: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly url: string;
  readonly expiresAt: Date;
}

export interface CreatorsInviteServiceDeps {
  readonly store: CreatorsInviteStore;
  readonly creatorsSlug: string | null;
  readonly secret: string;
  readonly appUrl: string;
  readonly isOptedOut: (email: string, communityId: string) => Promise<boolean>;
  readonly send: (message: CreatorsInviteMessage) => Promise<void>;
  readonly now?: () => Date;
}

export interface CreatorsInviteService {
  inviteCreator(input: CreatorsInviteInput): Promise<CreatorsInviteOutcome>;
}

// Derived from the person, not random, so the unique token column is the record that this person
// was invited: a second trigger, a retry, or a concurrent job finds the same row.
export function creatorsInviteToken(secret: string, userId: string): string {
  return createHmac("sha256", secret)
    .update(`cohory.creators-invite.v1:${userId}`)
    .digest("base64url");
}

export function createCreatorsInviteService(
  deps: CreatorsInviteServiceDeps,
): CreatorsInviteService {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  return {
    async inviteCreator(raw) {
      const input = creatorsInviteInputSchema.parse(raw);
      if (!deps.creatorsSlug) {
        return "disabled";
      }
      const creators = await deps.store.findCreatorsCommunity(deps.creatorsSlug);
      if (!creators || creators.archived || !creators.ownerId) {
        return "creators_unavailable";
      }
      if (creators.id === input.communityId) {
        return "creators_community";
      }
      const created = await deps.store.findCreatedCommunity(input.communityId);
      if (!created?.ownerId) {
        return "community_unavailable";
      }
      const at = now();
      if (
        input.trigger === "created" &&
        at.getTime() < created.createdAt.getTime() + creatorsInviteDelayDays * dayMs
      ) {
        return "not_due";
      }
      const userId = created.ownerId;
      if (userId === creators.ownerId) {
        return "creators_owner";
      }
      const token = creatorsInviteToken(deps.secret, userId);
      if (await deps.store.inviteExists(token)) {
        return "already_invited";
      }
      const creator = await deps.store.findCreator(userId);
      if (!creator || creator.closing) {
        return "account_closing";
      }
      const membership = await deps.store.findMembership(creators.id, userId, creator.email);
      if (membership === "active") {
        return "member";
      }
      if (membership === "banned") {
        return "banned";
      }
      if (!creator.emailVerified) {
        return "unconfirmed";
      }
      if (await deps.isOptedOut(creator.email, creators.id)) {
        return "opted_out";
      }
      const expiresAt = new Date(at.getTime() + creatorsInviteLifetimeDays * dayMs);
      const inserted = await deps.store.insertInvite(
        creators.id,
        { token, createdBy: creators.ownerId, expiresAt, label: creatorsInviteLabel },
        () =>
          deps.send({
            to: creator.email,
            name: creator.name,
            inviterName: creators.ownerName,
            community: {
              id: creators.id,
              slug: creators.slug,
              name: creators.name,
            },
            url: `${appUrl}/join/${token}`,
            expiresAt,
          }),
      );
      return inserted ? "sent" : "already_invited";
    },
  };
}
