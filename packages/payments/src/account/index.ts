import { getDb, type Database } from "@cohory/db";

import { createPostgresPaymentsRepository } from "../postgres-repository";
import { createPaidCommunityBlockers, type PaidCommunityBlockers } from "./blockers";
import { createListMyPaidMemberships, type PaidMembershipRow } from "./billing";

export type { PaidCommunityBlockers } from "./blockers";
export type { PaidMembershipBilling, PaidMembershipRow } from "./billing";

export interface AccountBillingOptions {
  readonly db: Database;
  readonly now?: () => Date;
}

export interface AccountBilling {
  readonly paidCommunityBlockers: PaidCommunityBlockers;
  readonly listMyPaidMemberships: ReturnType<typeof createListMyPaidMemberships>;
}

export function createAccountBilling(options: AccountBillingOptions): AccountBilling {
  const repo = createPostgresPaymentsRepository(options.db);
  return {
    paidCommunityBlockers: createPaidCommunityBlockers(repo),
    listMyPaidMemberships: createListMyPaidMemberships({
      db: options.db,
      repo,
      now: options.now ?? (() => new Date()),
    }),
  };
}

let defaultBilling: AccountBilling | undefined;

export function getAccountBilling(): AccountBilling {
  defaultBilling ??= createAccountBilling({ db: getDb() });
  return defaultBilling;
}

export function paidCommunityBlockers(): PaidCommunityBlockers {
  return (communityIds) => getAccountBilling().paidCommunityBlockers(communityIds);
}

export function listMyPaidMemberships(
  actor: Parameters<AccountBilling["listMyPaidMemberships"]>[0],
): Promise<PaidMembershipRow[]> {
  return getAccountBilling().listMyPaidMemberships(actor);
}
