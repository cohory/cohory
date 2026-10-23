import { grants } from "../access";
import type { ProviderSubscription } from "../providers/types";
import type { PaymentsStore, SubscriptionRecord } from "../repository";
import { callStripe, type Runtime } from "./context";
import type { Processing } from "./normalized-events";

export const duplicateCancellationComment = "cohory: second paid subscription for the same member";

export interface DuplicateCheck {
  readonly record: SubscriptionRecord;
  readonly previouslyGranting: boolean;
  readonly subscription: ProviderSubscription;
  readonly fromCheckout: boolean;
}

export type DuplicateAction =
  | {
      readonly kind: "cancel_and_refund";
      readonly record: SubscriptionRecord;
      readonly kept: SubscriptionRecord;
    }
  | { readonly kind: "refund"; readonly record: SubscriptionRecord };

export async function findDuplicate(
  store: PaymentsStore,
  check: DuplicateCheck,
): Promise<DuplicateAction | null> {
  const { record, subscription } = check;
  if (!check.fromCheckout || record.origin === "linked_import") {
    return null;
  }
  if (subscription.cancellationComment === duplicateCancellationComment) {
    return check.previouslyGranting && !grants(record.accessState)
      ? { kind: "refund", record }
      : null;
  }
  if (record.cancelAtPeriodEnd || !grants(record.accessState)) {
    return null;
  }
  const kept = await store.findEarlierRenewingSubscription(record);
  return kept ? { kind: "cancel_and_refund", record, kept } : null;
}

export async function settleDuplicate(
  runtime: Runtime,
  work: Processing,
  action: DuplicateAction,
): Promise<void> {
  const { provider, conn } = work;
  const { record } = action;
  const paidPaymentRefs = provider.paidPaymentRefs?.bind(provider);
  if (!paidPaymentRefs) {
    runtime.log({
      msg: "member has two paid subscriptions and the provider cannot refund one automatically",
      level: "warn",
      subscriptionId: record.id,
    });
    return;
  }
  const key = `duplicate:${record.id}`;
  if (action.kind === "cancel_and_refund") {
    const kept = await callStripe(runtime, () =>
      provider.getSubscription(action.kept.externalSubscriptionId, conn),
    );
    if (kept.status !== "active" || kept.cancelAtPeriodEnd) {
      runtime.log({
        msg: "member has two paid subscriptions but the first one is not renewing, left both",
        level: "warn",
        subscriptionId: record.id,
        keptSubscriptionId: action.kept.id,
      });
      return;
    }
    await callStripe(runtime, () =>
      provider.cancelSubscription(
        record.externalSubscriptionId,
        {
          atPeriodEnd: false,
          idempotencyKey: `${key}:cancel`,
          comment: duplicateCancellationComment,
        },
        conn,
      ),
    );
  }
  const refs = await callStripe(runtime, () =>
    paidPaymentRefs(record.externalSubscriptionId, conn),
  );
  let refundedMinor = 0;
  let currency: string | null = null;
  for (const ref of refs) {
    const refund = await callStripe(runtime, () =>
      provider.refund(ref, "full", `${key}:refund:${ref}`, conn),
    );
    refundedMinor += refund.amountMinor;
    currency = refund.currency;
  }
  runtime.log({
    msg: "cancelled and refunded a second paid subscription for the same member",
    level: "warn",
    subscriptionId: record.id,
    refunds: refs.length,
  });
  const community = await runtime.repo.findCommunity(work.communityId);
  const notice =
    community && currency !== null && refundedMinor > 0
      ? {
          type: "payments.duplicate_refunded" as const,
          payload: {
            noticeId: runtime.newId(),
            communityId: community.id,
            communitySlug: community.slug,
            communityName: community.name,
            userId: record.userId,
            amountMinor: refundedMinor,
            currency,
          },
        }
      : null;
  await runtime.repo.inCommunityAsSystem(work.communityId, async (store) => {
    await store.setSubscriptionAccessState(record.id, "revoked");
    if (notice) {
      await store.exit.appendNotices([notice], "community");
    }
  });
}
