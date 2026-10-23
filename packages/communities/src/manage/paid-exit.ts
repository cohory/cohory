import type { CommunityId, ScopedQueries } from "@cohory/db";
import {
  getPaymentsService,
  prepareCommunityDeletion,
  type MemberRemovedByStaff,
} from "@cohory/payments";

export type { MemberRemovedByStaff };

export type ArchivePaidMembers = "stop_at_period_end" | "keep_billing";

export interface ArchiveInput {
  readonly paidMembers?: ArchivePaidMembers;
  readonly includeLinked?: boolean;
}

export interface BeginArchiveInput {
  readonly communityId: CommunityId;
  readonly actorId: string;
  readonly choice: ArchivePaidMembers;
  readonly includeLinked: boolean;
}

export interface BeginDeletionInput {
  readonly communityId: CommunityId;
  readonly actorId: string;
  readonly includeLinked: boolean;
  readonly confirmedManualCancellation: boolean;
}

export type DeletionStart =
  { readonly kind: "ready" } | { readonly kind: "queued"; readonly runId: string };

export interface PrepareDeletionInput {
  readonly communityName: string;
  readonly now: Date;
}

export interface PaidExitPort {
  beginArchive(input: BeginArchiveInput): Promise<void>;
  beginDeletion(input: BeginDeletionInput): Promise<DeletionStart>;
  deletionReady(communityId: CommunityId): Promise<boolean>;
  prepareDeletion(queries: ScopedQueries, input: PrepareDeletionInput): Promise<boolean>;
  endMemberBilling(event: MemberRemovedByStaff): Promise<void>;
}

export const paymentsPaidExit: PaidExitPort = {
  async beginArchive(input) {
    await getPaymentsService().beginArchive(input);
  },
  beginDeletion: (input) => getPaymentsService().beginDeletion(input),
  deletionReady: (communityId) => getPaymentsService().deletionReady(communityId),
  async prepareDeletion(queries, input) {
    return (await prepareCommunityDeletion(queries, input)).kind === "detached";
  },
  async endMemberBilling(event) {
    await getPaymentsService().requestBillingEndForRemovedMember(event);
  },
};
