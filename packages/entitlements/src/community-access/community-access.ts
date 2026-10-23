import {
  findConnectionClosedAtIn,
  findMembershipIn,
  findOpenCompIn,
  findSubscriptionForUserIn,
  hasActivePlanIn,
  readRlsSetting,
  runInCommunity,
  setRlsValue,
  type CommunityScope,
  type ScopedQueries,
  type Transaction,
} from "@cohory/db";
import type { MemberRole } from "@cohory/db/schema";

import { hasAccess, resolveMembershipAccess, type AccessInput } from "./membership-access";

export interface CommunityAccess {
  readonly role: MemberRole | null;
  readonly entitled: boolean;
}

export const noCommunityAccess: CommunityAccess = { role: null, entitled: false };

export function communityAccessFrom(input: AccessInput): CommunityAccess {
  const { membership } = input;
  if (membership?.status !== "active") {
    return noCommunityAccess;
  }
  return { role: membership.role, entitled: hasAccess(resolveMembershipAccess(input)) };
}

type Queries = Pick<ScopedQueries, "tx" | "where" | "communityId">;

// Subscriptions and comps are readable only as their own user, and some callers run without app.user_id.
async function asUser<T>(tx: Transaction, userId: string, fn: () => Promise<T>): Promise<T> {
  const before = await readRlsSetting(tx, "user_id");
  if (before === userId) {
    return fn();
  }
  await setRlsValue(tx, "user_id", userId);
  const result = await fn();
  // On failure the setting is left as is: the statement error aborts the transaction, which
  // discards it, and a reset would only replace the real error with "transaction is aborted".
  await setRlsValue(tx, "user_id", before);
  return result;
}

export function getCommunityAccess(
  scope: CommunityScope,
  userId: string,
  now: Date,
): Promise<CommunityAccess> {
  return runInCommunity(scope, (queries) => communityAccessIn(queries, userId, now));
}

export async function communityAccessIn(
  queries: Queries,
  userId: string,
  now: Date,
): Promise<CommunityAccess> {
  const membership = await findMembershipIn(queries, userId);
  if (membership?.status !== "active") {
    return noCommunityAccess;
  }
  return asUser(queries.tx, userId, async () => {
    const found = await findSubscriptionForUserIn(queries, userId);
    const subscription = found
      ? {
          ...found,
          connectionClosedAt: await findConnectionClosedAtIn(queries, found.connectionId),
        }
      : null;
    // An open comp can only add access, and the plan only matters without an active membership,
    // so both are read only when the cheaper facts deny.
    const withoutComp = communityAccessFrom({
      membership,
      subscription,
      comp: null,
      paidPlanActive: true,
      now,
    });
    if (withoutComp.entitled) {
      return withoutComp;
    }
    return communityAccessFrom({
      membership,
      subscription,
      comp: await findOpenCompIn(queries, userId),
      paidPlanActive: await hasActivePlanIn(queries),
      now,
    });
  });
}
