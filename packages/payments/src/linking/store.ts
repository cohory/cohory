import type { PlanInterval, SubscriptionLinkStatus, subscriptionLinks } from "@cohory/db/schema";

import type { MatchCandidate } from "./match";

export type SubscriptionLinkRecord = typeof subscriptionLinks.$inferSelect;

export interface MatchedUserRow extends MatchCandidate {
  readonly email: string;
}

export interface NewSubscriptionLink {
  readonly connectionId: string;
  readonly externalSubscriptionId: string;
  readonly externalCustomerId: string;
  readonly externalPriceId: string | null;
  readonly email: string;
  readonly planId: string | null;
  readonly interval: PlanInterval;
  readonly status: SubscriptionLinkStatus;
  readonly userId: string | null;
  readonly subscriptionId: string | null;
  readonly applicationFeeBps: number;
  readonly createdBy: string | null;
  readonly linkedAt: Date | null;
}

export interface LinkCompletion {
  readonly userId: string;
  readonly subscriptionId: string;
  readonly at: Date;
}

export interface UserIdentity {
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface LinkAudit {
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string;
  readonly metadata: Record<string, unknown>;
}

export interface LinkStore {
  matchUsersByEmail(emails: readonly string[]): Promise<MatchedUserRow[]>;
  bannedEmails(emails: readonly string[]): Promise<Set<string>>;
  customerOwners(
    connectionId: string,
    externalCustomerIds: readonly string[],
  ): Promise<Map<string, string>>;
  findIdentity(userId: string): Promise<UserIdentity | null>;
  statuses(
    externalSubscriptionIds: readonly string[],
  ): Promise<Map<string, SubscriptionLinkStatus>>;
  insert(link: NewSubscriptionLink): Promise<SubscriptionLinkRecord | null>;
  listInvited(email: string): Promise<SubscriptionLinkRecord[]>;
  complete(linkId: string, completion: LinkCompletion): Promise<boolean>;
  list(limit: number): Promise<SubscriptionLinkRecord[]>;
  appendAudit(entry: LinkAudit): Promise<void>;
}
