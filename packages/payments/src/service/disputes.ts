import type { PaymentDisputeStatus } from "@cohory/db/schema";

import type { PaidMembershipEvent } from "../exit/events";
import { disputeFeeRefundDue } from "../fee";
import type { PlatformFee, ProviderDispute } from "../providers/types";
import type { CommunityRecord, PaymentsStore } from "../repository";
import type { Runtime } from "./context";
import type { Processing } from "./normalized-events";

export type FeeEntriesWriter = (
  store: PaymentsStore,
  work: Processing,
  fee: PlatformFee,
  chargedMinor: number,
  paymentRef: string | null,
) => Promise<void>;

export interface DisputeHandlers {
  disputeChanged(work: Processing, dispute: ProviderDispute): Promise<void>;
  fraudWarning(work: Processing, chargeRef: string | null): void;
}

export function nextDisputeStatus(
  previous: PaymentDisputeStatus | null,
  incoming: PaymentDisputeStatus,
): PaymentDisputeStatus {
  return previous !== null && previous !== "open" && incoming === "open" ? previous : incoming;
}

function disputeNotice(
  noticeId: string,
  community: CommunityRecord,
  ownerId: string,
  dispute: ProviderDispute,
): PaidMembershipEvent {
  return {
    type: "payments.payment_disputed",
    payload: {
      noticeId,
      communityId: community.id,
      communitySlug: community.slug,
      communityName: community.name,
      ownerId,
      amountMinor: dispute.disputedMinor,
      currency: dispute.currency,
    },
  };
}

export function createDisputeHandlers(
  runtime: Runtime,
  writeFeeEntries: FeeEntriesWriter,
): DisputeHandlers {
  const { repo } = runtime;

  async function markPayment(work: Processing, dispute: ProviderDispute): Promise<void> {
    await repo.inCommunityAsSystem(work.communityId, async (store) => {
      const payment = dispute.paymentRef
        ? await store.lockPaymentByIntent(dispute.paymentRef)
        : null;
      if (!payment) {
        runtime.log({
          msg: "dispute for a payment Cohory has not recorded",
          level: "warn",
          connectionId: work.connection.id,
          disputeId: dispute.id,
        });
        return;
      }
      await store.setPaymentDispute(payment.id, {
        disputeStatus: nextDisputeStatus(payment.disputeStatus, dispute.status),
        disputedAt: payment.disputedAt ?? dispute.openedAt,
      });
      if (payment.disputeStatus !== null) {
        return;
      }
      const ownerId = await store.findOwnerId();
      const community = ownerId ? await repo.findCommunity(work.communityId) : null;
      if (community && ownerId) {
        await store.exit.appendNotices(
          [disputeNotice(runtime.newId(), community, ownerId, dispute)],
          "community",
        );
      }
    });
  }

  async function refundFeeOnLoss(work: Processing, dispute: ProviderDispute): Promise<void> {
    const fees = work.provider.platformFees;
    if (dispute.status !== "lost" || !dispute.platformFeeId || !fees) {
      return;
    }
    const fee = await fees.get(dispute.platformFeeId, work.conn);
    const due = disputeFeeRefundDue({
      feeMinor: fee.amount,
      chargedMinor: dispute.chargedMinor,
      refundedMinor: dispute.refundedMinor,
      disputedMinor: dispute.disputedMinor,
      feeRefundedMinor: fee.amountRefunded,
    });
    const current =
      due > 0
        ? await fees
            .refund(fee.id, due, `fee-refund:dispute:${dispute.id}`, work.conn, dispute.id)
            .then(() => fees.get(fee.id, work.conn))
        : fee;
    await repo.inCommunityAsSystem(work.communityId, (store) =>
      writeFeeEntries(store, work, current, dispute.chargedMinor, dispute.paymentRef),
    );
  }

  return {
    async disputeChanged(work, dispute) {
      await markPayment(work, dispute);
      await refundFeeOnLoss(work, dispute);
    },

    fraudWarning(work, chargeRef) {
      runtime.log({
        msg: "early fraud warning received",
        level: "warn",
        connectionId: work.connection.id,
        chargeId: chargeRef,
      });
    },
  };
}
