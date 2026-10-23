import { appendDisconnectNotices, closeConnection } from "../exit/kinds/disconnect";
import { allocateFeeRefunds } from "../fee";
import type { PaymentProvider } from "../providers/types";
import type { ConnectionRecord } from "../repository";
import type { Processing } from "./normalized-events";
import type { Runtime } from "./context";

export function isExited(connection: ConnectionRecord): boolean {
  return connection.status === "disconnecting" || connection.status === "disconnected";
}

export function isFeeAfterExit(
  type: string,
  connection: ConnectionRecord,
  provider: PaymentProvider,
): boolean {
  return isExited(connection) && (provider.platformFees?.isFeeEvent(type) ?? false);
}

export interface ExitWebhookHandlers {
  refundFeeAfterExit(work: Processing, feeId: string): Promise<void>;
  deauthorize(work: Processing): Promise<void>;
}

export function createExitWebhookHandlers(runtime: Runtime): ExitWebhookHandlers {
  const { repo } = runtime;

  return {
    async refundFeeAfterExit(work, feeId) {
      const fees = work.provider.platformFees;
      if (!fees) {
        return;
      }
      const fee = await fees.get(feeId, work.conn);
      if (fee.accountId !== work.connection.externalAccountId) {
        return;
      }
      const due = fee.amount - fee.amountRefunded;
      if (due > 0) {
        await fees.refund(fee.id, due, `exit-fee-refund:${fee.id}`, work.conn, null);
      }
      const current = due > 0 ? await fees.get(fee.id, work.conn) : fee;
      const shares = allocateFeeRefunds(current.refunds, current);
      await repo.inCommunityAsSystem(work.communityId, async (store) => {
        await store.insertLedgerEntry({
          paymentId: null,
          kind: "fee_collected",
          provider: work.connection.provider,
          collectionMethod: "automatic_split",
          currency: current.currency,
          baseMinor: 0,
          rateBps: 0,
          computedFeeMinor: 0,
          providerFeeMinor: current.amount,
          externalRef: current.id,
          idempotencyKey: `fee:collected:${current.id}`,
          occurredAt: current.createdAt,
        });
        for (const refund of current.refunds) {
          await store.insertLedgerEntry({
            paymentId: null,
            kind: "fee_refunded",
            provider: work.connection.provider,
            collectionMethod: "automatic_split",
            currency: current.currency,
            baseMinor: 0,
            rateBps: 0,
            computedFeeMinor: 0,
            providerFeeMinor: -(shares.get(refund.id) ?? 0),
            externalRef: refund.id,
            idempotencyKey: `fee:refunded:${refund.id}`,
            occurredAt: refund.createdAt,
          });
        }
      });
      runtime.log({
        msg: "platform fee received after exit",
        level: "warn",
        connectionId: work.connection.id,
        feeId: current.id,
        refunded: due > 0,
      });
    },

    async deauthorize(work) {
      if (work.connection.status === "disconnected") {
        return;
      }
      const now = runtime.now();
      const community = await repo.findCommunity(work.communityId);
      await repo.inCommunityAsSystem(work.communityId, async (store) => {
        const unfinished = await store.exit.findUnfinishedRun();
        if (unfinished && unfinished.connectionId === work.connection.id) {
          await store.exit.updateRun(unfinished.id, { status: "failed", finishedAt: now });
        }
        await closeConnection(store, work.connection, now);
        const subs = await store.exit.listExitSubscriptions(work.connection.id);
        const run = await store.exit.insertRun({
          id: runtime.newId(),
          kind: "disconnect",
          choice: "take_members",
          connectionId: work.connection.id,
          includeLinked: true,
          requestedBy: null,
          portalLoginUrl: null,
          manualCancellationConfirmedAt: null,
          targetCount: subs.length,
          status: "done",
        });
        await store.exit.updateRun(run.id, { doneCount: subs.length, finishedAt: now });
        const ownerId = await store.findOwnerId();
        if (!community || !ownerId) {
          return;
        }
        await appendDisconnectNotices(store, {
          run,
          community,
          actorId: ownerId,
          ending: [],
          continuing: subs.map((sub) => ({ userId: sub.userId, endsAt: null })),
          feeClearRequired: true,
          contactUserId: work.connection.acceptedOwnerId,
        });
      });
      runtime.log({
        msg: "connection closed after Stripe deauthorization",
        level: "warn",
        connectionId: work.connection.id,
      });
    },
  };
}
