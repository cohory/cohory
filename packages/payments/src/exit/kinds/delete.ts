import { withRlsFlags, type ScopedQueries } from "@cohory/db";

import { decideBilling } from "../../billing/minimum";
import { DeletionBlockedByBillingError, type DeletionBillingBlock } from "../../errors";
import { paidMembershipEvents, type PaidMembershipEvent } from "../events";
import { latestExitRun } from "../latest-run";
import { createExitStore } from "../postgres-store";
import type { BillingBlockers, DetachResult, ExitStore } from "../store";
import type { ExitKindHook } from "./types";

export interface CommunityDeletionInput {
  readonly communityName: string;
  readonly now: Date;
}

export type CommunityDeletion =
  { readonly kind: "detached"; readonly detached: DetachResult } | { readonly kind: "not_ready" };

export function billingBlock(blockers: BillingBlockers): DeletionBillingBlock | null {
  if (blockers.unpaidInvoices > 0) {
    return "unpaid_invoice";
  }
  const invoiceable = blockers.openBalances.some(
    (balance) => decideBilling(balance.currency, balance.balanceMinor).kind === "invoice",
  );
  return invoiceable ? "open_balance" : null;
}

export async function deletionReady(exit: ExitStore): Promise<boolean> {
  if (await exit.findUnfinishedRun()) {
    return false;
  }
  const subs = await exit.listExitSubscriptions(null);
  if (subs.length === 0) {
    return true;
  }
  const latest = await latestExitRun(exit);
  return latest?.kind === "delete" && latest.status === "done";
}

export function prepareCommunityDeletion(
  queries: ScopedQueries,
  input: CommunityDeletionInput,
): Promise<CommunityDeletion> {
  const exit = createExitStore(queries);
  return withRlsFlags(
    queries.tx,
    ["payments_manager", "payments_webhook"],
    async (): Promise<CommunityDeletion> => {
      if (!(await deletionReady(exit))) {
        return { kind: "not_ready" };
      }
      const blockers = await exit.billingBlockers();
      const block = billingBlock(blockers);
      if (block) {
        throw new DeletionBlockedByBillingError(block);
      }
      for (const balance of blockers.openBalances) {
        await exit.writeOffFeeBalance({
          currency: balance.currency,
          provider: balance.provider,
          amountMinor: balance.balanceMinor,
          occurredAt: input.now,
        });
      }
      const detached = await exit.detachFinancialRecords({
        communityId: queries.communityId,
        communityName: input.communityName,
      });
      return { kind: "detached", detached };
    },
  );
}

export const deleteFinished: ExitKindHook = async (finish) => {
  if (finish.status !== "done") {
    return;
  }
  const open = await finish.store.findOpenConnection();
  const contactId = open?.acceptedOwnerId ?? (await finish.store.findOwnerId());
  const supportContact = contactId ? await finish.store.findUserEmail(contactId) : null;
  const cancelledByOwner = finish.run.manualCancellationConfirmedAt
    ? (await finish.store.exit.listExitSubscriptions(null)).filter(
        (sub) => sub.connectionId !== finish.run.connectionId,
      )
    : [];
  const base = {
    noticeId: finish.run.id,
    communityId: finish.community.id,
    communitySlug: finish.community.slug,
    communityName: finish.community.name,
    actorId: finish.actorId,
    portalLoginUrl: null,
  };
  const events: PaidMembershipEvent[] = [
    ...paidMembershipEvents({
      ...base,
      change: "community_deleted",
      supportContact: null,
      recipients: [
        ...finish.completed.map((target) => target.subscription),
        ...cancelledByOwner,
      ].map((sub) => ({ userId: sub.userId, endsAt: null })),
    }),
    ...paidMembershipEvents({
      ...base,
      change: "billed_by_creator",
      supportContact,
      recipients: finish.leftRunning.map((sub) => ({ userId: sub.userId, endsAt: null })),
    }),
  ];
  if (events.length > 0) {
    await finish.store.exit.appendNotices(events, "detached");
  }
};
