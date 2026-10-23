import type { CommunityId } from "@cohory/db";
import { z } from "zod";

import {
  accessStateFor,
  compGrants,
  grants,
  membershipSyncAction,
  type MembershipSyncAction,
  type SubscriptionAccessState,
} from "../access";
import {
  allocateFeeRefunds,
  computeApplicationFee,
  cumulativeFeeRefundDue,
  feeBpsFromPercent,
} from "../fee";
import type {
  Connection,
  NormalizedEvent,
  PaymentProvider,
  PlatformFee,
  ProviderPayment,
  ProviderRefund,
} from "../providers/types";
import type {
  ConnectionRecord,
  PaymentsStore,
  PlanRecord,
  SubscriptionRecord,
} from "../repository";
import { statePatch } from "./connection";
import { feeBpsFor, type Runtime } from "./context";
import { createDisputeHandlers } from "./disputes";
import { findDuplicate, settleDuplicate } from "./duplicate-subscriptions";
import { byoStatus } from "./provider-connection";
import { createExitWebhookHandlers } from "./exit-webhooks";
import { releaseHold } from "./holds";
import { appendPaymentFailedNotice, appendSubscriptionNotices } from "./member-notices";

export interface Processing {
  readonly connection: ConnectionRecord;
  readonly communityId: CommunityId;
  readonly provider: PaymentProvider;
  readonly conn: Connection;
}

const uuid = z.uuid();

export type NormalizedEventHandler = (work: Processing, event: NormalizedEvent) => Promise<void>;

export function createNormalizedEventHandler(runtime: Runtime): NormalizedEventHandler {
  const { repo } = runtime;
  const exit = createExitWebhookHandlers(runtime);

  async function membershipAction(
    store: PaymentsStore,
    userId: string,
    subscription: { id: string; previous: SubscriptionAccessState | null },
    next: SubscriptionAccessState,
  ): Promise<MembershipSyncAction> {
    const membership = await store.lockMember(userId);
    const action = membershipSyncAction({
      membership,
      previous: subscription.previous,
      next,
      otherAccess:
        !grants(next) &&
        ((await store.hasOtherGrantingSubscription(userId, subscription.id)) ||
          compGrants(await store.comps.findOpen(userId), runtime.now())),
    });
    if (action === "activate" && (await store.isEmailBanned(userId))) {
      return "none";
    }
    if (action === "remove" && (await store.exit.findUnfinishedRun())?.kind === "delete") {
      return "none";
    }
    return action;
  }

  async function applyMembershipAction(
    store: PaymentsStore,
    userId: string,
    action: MembershipSyncAction,
  ): Promise<void> {
    if (action === "activate") {
      const settled = await store.activateMember(userId, runtime.now());
      if (settled.kind === "invite_exhausted") {
        runtime.log({
          msg: "payer admitted past the invite limit",
          level: "warn",
          communityId: store.communityId,
          userId,
          inviteId: settled.inviteId,
        });
      }
    }
    if (action === "remove") {
      await store.removeMember(userId);
    }
  }

  function sellsPrice(plan: PlanRecord | null, priceId: string): boolean {
    return plan?.providerMonthlyPriceId === priceId || plan?.providerAnnualPriceId === priceId;
  }

  async function planForPrice(
    store: PaymentsStore,
    checkoutPlan: PlanRecord | null,
    stored: SubscriptionRecord | null,
    subscriptionId: string,
    priceId: string | null,
  ): Promise<PlanRecord | null> {
    if (!priceId || sellsPrice(checkoutPlan, priceId)) {
      return checkoutPlan;
    }
    const byPrice = await store.findPlanByPrice(priceId);
    if (byPrice) {
      return byPrice;
    }
    runtime.log({
      msg: "subscription price matches no plan",
      level: "warn",
      communityId: store.communityId,
      subscriptionId,
      priceId,
    });
    return stored?.planId ? store.findPlan(stored.planId) : null;
  }

  async function syncSubscription(
    work: Processing,
    subscriptionId: string,
    hint: { userId: string | null } = { userId: null },
  ): Promise<void> {
    const { connection, communityId } = work;
    const fetchedAt = runtime.now();
    const subscription = await work.provider.getSubscription(subscriptionId, work.conn);
    const metadata = subscription.metadata;
    const sameCommunity = metadata["cohory_community_id"] === communityId;
    const metadataUser = sameCommunity && uuid.safeParse(metadata["cohory_user_id"]).success;
    const duplicate = await repo.inCommunityAsSystem(communityId, async (store) => {
      const known = await store.findCustomerByExternal(connection.id, subscription.customerId);
      const userId =
        (metadataUser ? metadata["cohory_user_id"] : undefined) ?? known?.userId ?? hint.userId;
      if (!userId) {
        return null;
      }
      const customer = await store.upsertCustomer({
        userId,
        connectionId: connection.id,
        externalCustomerId: subscription.customerId,
      });
      const planId = sameCommunity ? metadata["cohory_plan_id"] : undefined;
      const checkoutPlan =
        planId && uuid.safeParse(planId).success ? await store.findPlan(planId) : null;
      const mirrored = await store.findSubscriptionByExternal(subscription.id);
      const plan = await planForPrice(
        store,
        checkoutPlan,
        mirrored,
        subscription.id,
        subscription.priceId,
      );
      const linked = mirrored?.origin === "linked_import" ? mirrored : null;
      const accessState = accessStateFor(
        subscription.status,
        subscription.currentPeriodEnd,
        fetchedAt,
      );
      const upsert = await store.upsertSubscription({
        userId,
        customerId: customer.id,
        connectionId: connection.id,
        planId: plan?.id ?? linked?.planId ?? null,
        externalSubscriptionId: subscription.id,
        externalPriceId: subscription.priceId,
        providerStatus: subscription.status,
        accessState,
        interval: linked ? linked.interval : subscription.interval,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        endedAt: subscription.endedAt,
        applicationFeeBps: feeBpsFromPercent(subscription.applicationFeePercent),
        providerFetchedAt: fetchedAt,
      });
      if (!upsert.applied) {
        return null;
      }
      const action = await membershipAction(
        store,
        userId,
        { id: upsert.record.id, previous: upsert.previous?.accessState ?? null },
        accessState,
      );
      await applyMembershipAction(store, userId, action);
      await store.moves.markResubscribed(userId, upsert.record.id, fetchedAt);
      await appendSubscriptionNotices(runtime, store, communityId, upsert);
      return findDuplicate(store, {
        record: upsert.record,
        previouslyGranting: upsert.previous !== null && grants(upsert.previous.accessState),
        subscription,
        fromCheckout: metadataUser && metadata["cohory_user_id"] === userId && plan !== null,
      });
    });
    if (duplicate) {
      await settleDuplicate(runtime, work, duplicate);
    }
  }

  async function writeFeeEntries(
    store: PaymentsStore,
    work: Processing,
    fee: PlatformFee,
    chargeAmount: number,
    paymentRef: string | null,
  ): Promise<void> {
    const payment = paymentRef ? await store.findPaymentByIntent(paymentRef) : null;
    const subscription = payment?.subscriptionId
      ? await store.findSubscription(payment.subscriptionId)
      : null;
    const rateBps = subscription?.applicationFeeBps ?? feeBpsFor(runtime, work.connection);
    const computed = computeApplicationFee(chargeAmount, rateBps);
    await store.insertLedgerEntry({
      paymentId: payment?.id ?? null,
      kind: "fee_collected",
      provider: work.connection.provider,
      collectionMethod: "automatic_split",
      currency: fee.currency,
      baseMinor: chargeAmount,
      rateBps,
      computedFeeMinor: computed,
      providerFeeMinor: fee.amount,
      externalRef: fee.id,
      idempotencyKey: `fee:collected:${fee.id}`,
      occurredAt: fee.createdAt,
    });
    if (Math.abs(computed - fee.amount) > 1) {
      runtime.log({
        msg: "application fee differs from computed fee",
        level: "warn",
        feeId: fee.id,
        computed,
        reported: fee.amount,
      });
    }
    const shares = allocateFeeRefunds(fee.refunds, fee);
    for (const refund of fee.refunds) {
      const refunded = shares.get(refund.id) ?? 0;
      await store.insertLedgerEntry({
        paymentId: payment?.id ?? null,
        kind: "fee_refunded",
        provider: work.connection.provider,
        collectionMethod: "automatic_split",
        currency: fee.currency,
        baseMinor: 0,
        rateBps,
        computedFeeMinor: -refunded,
        providerFeeMinor: -refunded,
        externalRef: refund.id,
        idempotencyKey: `fee:refunded:${refund.id}`,
        occurredAt: refund.createdAt,
        reason: refund.disputeId ? "dispute_lost" : null,
      });
    }
  }

  const disputes = createDisputeHandlers(runtime, writeFeeEntries);

  function accruesFees(work: Processing): number {
    if (work.provider.capabilities(work.conn).supportsFeeSplit) {
      return 0;
    }
    return feeBpsFor(runtime, work.connection);
  }

  async function recordPayment(work: Processing, payment: ProviderPayment): Promise<void> {
    const rateBps = accruesFees(work);
    await repo.inCommunityAsSystem(work.communityId, async (store) => {
      const subscription = payment.subscriptionId
        ? await store.findSubscriptionByExternal(payment.subscriptionId)
        : null;
      if (!subscription && work.provider.setup === "access_token") {
        return;
      }
      const taxMinor = Math.min(payment.taxMinor, payment.amountMinor);
      const recorded = await store.upsertPayment({
        subscriptionId: subscription?.id ?? null,
        externalInvoiceId: payment.externalId,
        externalPaymentIntentId: payment.paymentRef,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        taxMinor,
        occurredAt: payment.paidAt ?? runtime.now(),
      });
      if (rateBps === 0 || !subscription) {
        return;
      }
      const baseMinor = payment.amountMinor - taxMinor;
      await store.insertLedgerEntry({
        paymentId: recorded.id,
        kind: "fee_accrued",
        provider: work.connection.provider,
        collectionMethod: "periodic_invoice",
        currency: payment.currency,
        baseMinor,
        rateBps,
        computedFeeMinor: computeApplicationFee(baseMinor, rateBps),
        providerFeeMinor: null,
        externalRef: payment.externalId,
        idempotencyKey: `fee:accrued:${work.connection.provider}:${payment.externalId}`,
        occurredAt: payment.paidAt ?? runtime.now(),
      });
    });
  }

  async function reverseAccruedFee(
    store: PaymentsStore,
    work: Processing,
    paymentId: string,
    currency: string,
    refund: ProviderRefund,
  ): Promise<void> {
    const rateBps = accruesFees(work);
    const totals = await store.accruedFeeTotals(paymentId);
    if (rateBps === 0 || totals.accruedMinor === 0) {
      return;
    }
    const due = cumulativeFeeRefundDue({
      feeMinor: totals.accruedMinor,
      chargedMinor: refund.chargedMinor,
      refundedMinor: Math.min(refund.refundedMinor, refund.chargedMinor),
      feeRefundedMinor: totals.refundedMinor,
    });
    if (due === 0) {
      return;
    }
    await store.insertLedgerEntry({
      paymentId,
      kind: "fee_refunded",
      provider: work.connection.provider,
      collectionMethod: "periodic_invoice",
      currency,
      baseMinor: 0,
      rateBps,
      computedFeeMinor: -due,
      providerFeeMinor: null,
      externalRef: refund.chargeRef,
      idempotencyKey: `fee:refunded:${work.connection.provider}:${refund.chargeRef}:${refund.refundedMinor}`,
      occurredAt: runtime.now(),
    });
  }

  async function refundPlatformFee(work: Processing, refund: ProviderRefund): Promise<void> {
    const fees = work.provider.platformFees;
    if (!refund.platformFeeId || !fees) {
      return;
    }
    const fee = await fees.get(refund.platformFeeId, work.conn);
    const due = cumulativeFeeRefundDue({
      feeMinor: fee.amount,
      chargedMinor: refund.chargedMinor,
      refundedMinor: refund.refundedMinor,
      feeRefundedMinor: fee.amountRefunded,
    });
    const current =
      due > 0
        ? await fees
            .refund(
              fee.id,
              due,
              `fee-refund:${refund.chargeRef}:${refund.refundedMinor}`,
              work.conn,
              null,
            )
            .then(() => fees.get(fee.id, work.conn))
        : fee;
    await repo.inCommunityAsSystem(work.communityId, (store) =>
      writeFeeEntries(store, work, current, refund.chargedMinor, refund.paymentRef),
    );
  }

  async function recordRefund(work: Processing, refund: ProviderRefund): Promise<void> {
    await repo.inCommunityAsSystem(work.communityId, async (store) => {
      const payment = refund.paymentRef ? await store.findPaymentByIntent(refund.paymentRef) : null;
      if (payment) {
        await store.setPaymentRefunded(
          payment.id,
          Math.min(refund.paymentRefundedMinor, payment.amountMinor),
        );
        await reverseAccruedFee(store, work, payment.id, payment.currency, refund);
      }
    });
    await refundPlatformFee(work, refund);
  }

  async function refreshAccount(work: Processing): Promise<void> {
    const state = await work.provider.getAccountState(work.conn);
    const byo = work.provider.setup === "access_token";
    await repo.inCommunityAsSystem(work.communityId, (store) =>
      store.updateConnection(work.connection.id, {
        ...statePatch(state),
        ...(byo
          ? {
              status: byoStatus(state, work.connection.webhookSecretEncrypted !== null),
              livemode: work.connection.livemode,
            }
          : {}),
      }),
    );
  }

  return async (work, event) => {
    switch (event.kind) {
      case "checkout_completed":
        await syncSubscription(work, event.subscriptionId, { userId: event.userIdHint });
        if (!work.connection.livemode) {
          await repo.inCommunityAsSystem(work.communityId, (store) =>
            store.markTestCheckoutSucceeded(runtime.now()),
          );
        }
        return;
      case "checkout_expired":
        if (event.userIdHint) {
          await releaseHold(runtime, work.communityId, event.userIdHint);
        }
        return;
      case "subscription_changed":
        await syncSubscription(work, event.subscriptionId);
        return;
      case "payment_succeeded":
        await recordPayment(work, event.payment);
        return;
      case "payment_refunded":
        await recordRefund(work, event.refund);
        return;
      case "payment_failed":
        await appendPaymentFailedNotice(runtime, work.communityId, event.failure);
        return;
      case "platform_fee_reported":
        await repo.inCommunityAsSystem(work.communityId, (store) =>
          writeFeeEntries(store, work, event.fee, event.chargedMinor, event.paymentRef),
        );
        return;
      case "dispute_changed":
        await disputes.disputeChanged(work, event.dispute);
        return;
      case "fraud_warning":
        disputes.fraudWarning(work, event.chargeRef);
        return;
      case "account_updated":
        await refreshAccount(work);
        return;
      case "account_deauthorized":
        await exit.deauthorize(work);
        return;
    }
  };
}
