import { createHash } from "node:crypto";

import type { CommunityId } from "@cohory/db";

import { grants, type SubscriptionAccessState } from "../access";
import type { PaidMembershipEvent, PaidMemberPayload } from "../exit/events";
import type { ProviderPaymentFailure } from "../providers/types";
import type { PaymentsStore, SubscriptionRecord, SubscriptionUpsert } from "../repository";
import type { Runtime } from "./context";

export const notifiedPaymentFailures = 3;

export interface SubscriptionFacts {
  readonly accessState: SubscriptionAccessState;
  readonly cancelAtPeriodEnd: boolean;
  readonly origin: string;
}

export type SubscriptionChange = "joined" | "canceled";

export function subscriptionChanges(
  previous: SubscriptionFacts | null,
  next: SubscriptionFacts,
): SubscriptionChange[] {
  const wasGranting = previous !== null && grants(previous.accessState);
  const changes: SubscriptionChange[] = [];
  if (grants(next.accessState) && !wasGranting && next.origin !== "linked_import") {
    changes.push("joined");
  }
  if (
    wasGranting &&
    grants(next.accessState) &&
    !previous.cancelAtPeriodEnd &&
    next.cancelAtPeriodEnd
  ) {
    changes.push("canceled");
  }
  return changes;
}

export function noticeIdFor(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function ownerNoticeBase(
  runtime: Runtime,
  store: PaymentsStore,
  communityId: CommunityId,
  subscription: SubscriptionRecord,
): Promise<Omit<PaidMemberPayload, "noticeId"> | null> {
  const ownerId = await store.findOwnerId();
  const community = ownerId ? await runtime.repo.findCommunity(communityId) : null;
  if (!ownerId || !community || ownerId === subscription.userId) {
    return null;
  }
  return {
    communityId: community.id,
    communitySlug: community.slug,
    communityName: community.name,
    ownerId,
    userId: subscription.userId,
  };
}

export async function appendSubscriptionNotices(
  runtime: Runtime,
  store: PaymentsStore,
  communityId: CommunityId,
  upsert: SubscriptionUpsert,
): Promise<void> {
  const changes = subscriptionChanges(upsert.previous, upsert.record);
  if (changes.length === 0) {
    return;
  }
  const base = await ownerNoticeBase(runtime, store, communityId, upsert.record);
  if (!base) {
    return;
  }
  const record = upsert.record;
  const plan = record.planId ? await store.findPlan(record.planId) : null;
  const prices = { month: plan?.monthlyPriceMinor, year: plan?.annualPriceMinor };
  const priceMinor = record.interval ? (prices[record.interval] ?? null) : null;
  const price = {
    priceMinor,
    currency: priceMinor === null ? null : (plan?.currency ?? null),
    interval: priceMinor === null ? null : record.interval,
  };
  const events = changes.map((change): PaidMembershipEvent => {
    const noticeId = runtime.newId();
    return change === "joined"
      ? { type: "payments.paid_member_joined", payload: { ...base, ...price, noticeId } }
      : {
          type: "payments.paid_member_canceled",
          payload: {
            ...base,
            noticeId,
            endsAt: upsert.record.currentPeriodEnd?.toISOString() ?? null,
          },
        };
  });
  await store.exit.appendNotices(events, "community");
}

export async function appendPaymentFailedNotice(
  runtime: Runtime,
  communityId: CommunityId,
  failure: ProviderPaymentFailure,
): Promise<void> {
  // Stripe's smart retries decide how many tries there are, so the last one is the
  // invoice without a next attempt, not a fixed count. It is reported even after the
  // cancellation it causes has already ended access.
  const final = failure.nextAttemptAt === null;
  if (failure.attempt < 1 || (!final && failure.attempt > notifiedPaymentFailures)) {
    return;
  }
  await runtime.repo.inCommunityAsSystem(communityId, async (store) => {
    const subscription = await store.findSubscriptionByExternal(failure.subscriptionRef);
    if (!subscription || (!final && !grants(subscription.accessState))) {
      return;
    }
    const base = await ownerNoticeBase(runtime, store, communityId, subscription);
    if (!base) {
      return;
    }
    await store.exit.appendNotices(
      [
        {
          type: "payments.member_payment_failed",
          payload: {
            ...base,
            noticeId: noticeIdFor(`member_payment_failed:${failure.invoiceRef}:${failure.attempt}`),
            amountMinor: failure.amountMinor,
            currency: failure.currency,
            attempt: failure.attempt,
            nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
          },
        },
      ],
      "community",
    );
  });
}
