import { assertCan, type Actor } from "@cohory/authz";

import {
  toLedgerCurrencySummary,
  toSubscriptionListItem,
  type LedgerSummary,
  type SubscriptionListItem,
} from "../views";
import { withAccess, type Runtime } from "./context";

export const subscriptionListLimit = 500;

export interface ReportOperations {
  listSubscriptions(actor: Actor, communityId: string): Promise<SubscriptionListItem[]>;
  getLedgerSummary(actor: Actor, communityId: string): Promise<LedgerSummary>;
}

export function createReportOperations(runtime: Runtime): ReportOperations {
  return {
    async listSubscriptions(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        const rows = await store.listSubscriptions(subscriptionListLimit);
        return rows.map(toSubscriptionListItem);
      });
    },

    async getLedgerSummary(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        const totals = await store.currencyTotals();
        return {
          edition: runtime.env.edition,
          platformFeeBps: runtime.env.edition === "cloud" ? runtime.env.platformFeeBps : 0,
          currencies: totals.map(toLedgerCurrencySummary),
        };
      });
    },
  };
}
