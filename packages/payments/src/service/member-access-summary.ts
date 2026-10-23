import { assertCan, type Actor } from "@cohory/authz";
import { z } from "zod";

import type { MemberAccessFacts, SubscriptionAccessFact } from "../access-summary/store";
import { parse, withAccess, type Runtime } from "./context";

export const memberAccessKinds = [
  "paying_monthly",
  "paying_yearly",
  "free_access",
  "past_due",
  "cancelling",
] as const;

export type MemberAccessKind = (typeof memberAccessKinds)[number];

export interface MemberAccessEntry {
  readonly access: MemberAccessKind;
  readonly until: Date | null;
}

export type MemberAccessMap = ReadonlyMap<string, MemberAccessEntry>;

export const maxMemberAccessLookup = 500;

const userIdsSchema = z.array(z.uuid()).max(maxMemberAccessLookup).nullable();

export interface MemberAccessSummaryOperations {
  listMemberAccess(
    actor: Actor,
    communityId: string,
    userIds?: readonly string[] | null,
  ): Promise<MemberAccessMap>;
}

function subscriptionRank(fact: SubscriptionAccessFact): number {
  if (fact.accessState === "granted") {
    return fact.cancelAtPeriodEnd ? 1 : 0;
  }
  return 2;
}

function subscriptionEntry(fact: SubscriptionAccessFact): MemberAccessEntry {
  const until = fact.currentPeriodEnd;
  if (fact.accessState !== "granted") {
    return { access: "past_due", until };
  }
  if (fact.cancelAtPeriodEnd) {
    return { access: "cancelling", until };
  }
  return { access: fact.interval === "year" ? "paying_yearly" : "paying_monthly", until };
}

export function summarizeMemberAccess(facts: MemberAccessFacts): Map<string, MemberAccessEntry> {
  const best = new Map<string, SubscriptionAccessFact>();
  for (const fact of facts.subscriptions) {
    const current = best.get(fact.userId);
    if (!current || subscriptionRank(fact) < subscriptionRank(current)) {
      best.set(fact.userId, fact);
    }
  }
  const summary = new Map<string, MemberAccessEntry>();
  for (const [userId, fact] of best) {
    summary.set(userId, subscriptionEntry(fact));
  }
  for (const comp of facts.comps) {
    if (!summary.has(comp.userId)) {
      summary.set(comp.userId, { access: "free_access", until: comp.expiresAt });
    }
  }
  return summary;
}

export function createMemberAccessSummaryOperations(
  runtime: Runtime,
): MemberAccessSummaryOperations {
  return {
    async listMemberAccess(actor, communityId, userIds = null) {
      const ids = parse(userIdsSchema, userIds === null ? null : [...new Set(userIds)]);
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        return summarizeMemberAccess(await store.accessSummary.listAccessFacts(ids, runtime.now()));
      });
    },
  };
}
