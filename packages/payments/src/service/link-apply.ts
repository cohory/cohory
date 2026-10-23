import type { CommunityId } from "@cohory/db";
import type { PlanInterval } from "@cohory/db/schema";

import { accessStateFor, membershipSyncAction, type MembershipSyncAction } from "../access";
import type { GatewaySubscriptionSummary } from "../gateway";
import type { ConnectionRecord, PaymentsStore, SubscriptionRecord } from "../repository";
import { feeBpsFromPercent } from "../fee";
import { callStripe, feeBpsFor, providerFor, splitsFees, type Runtime } from "./context";

export interface LinkTarget {
  readonly connection: ConnectionRecord;
  readonly summary: GatewaySubscriptionSummary;
  readonly email: string;
  readonly userId: string;
  readonly interval: PlanInterval;
  readonly planId: string | null;
  readonly feeBps: number;
  readonly actorId: string | null;
  readonly inviteId: string | null;
}

export type AppliedLink =
  | {
      readonly kind: "linked";
      readonly subscription: SubscriptionRecord;
      readonly action: MembershipSyncAction;
    }
  | { readonly kind: "already_linked" }
  | { readonly kind: "customer_conflict" }
  | { readonly kind: "banned" };

export async function applyLink(
  runtime: Runtime,
  store: PaymentsStore,
  target: LinkTarget,
): Promise<AppliedLink> {
  const { connection, summary, userId } = target;
  const now = runtime.now();
  if (await store.findSubscriptionByExternal(summary.id)) {
    return { kind: "already_linked" };
  }
  if (
    (await store.findMember(userId))?.status === "banned" ||
    (await store.isEmailBanned(userId))
  ) {
    return { kind: "banned" };
  }
  const known = await store.findCustomerByExternal(connection.id, summary.customerId);
  if (known && known.userId !== userId) {
    return { kind: "customer_conflict" };
  }
  const customer =
    known ??
    (await store.upsertCustomer({
      userId,
      connectionId: connection.id,
      externalCustomerId: summary.customerId,
    }));
  const accessState = accessStateFor(summary.status);
  const { record } = await store.upsertSubscription({
    userId,
    customerId: customer.id,
    connectionId: connection.id,
    planId: target.planId,
    externalSubscriptionId: summary.id,
    providerStatus: summary.status,
    accessState,
    interval: target.interval,
    currentPeriodEnd: summary.currentPeriodEnd,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    endedAt: null,
    applicationFeeBps: feeBpsFromPercent(summary.applicationFeePercent),
    providerFetchedAt: now,
    origin: "linked_import",
    externalPriceId: summary.priceId,
  });
  const completion = { userId, subscriptionId: record.id, at: now };
  const recorded = target.inviteId
    ? await store.links.complete(target.inviteId, completion)
    : (await store.links.insert({
        connectionId: connection.id,
        externalSubscriptionId: summary.id,
        externalCustomerId: summary.customerId,
        externalPriceId: summary.priceId,
        email: target.email,
        planId: target.planId,
        interval: target.interval,
        status: "linked",
        userId,
        subscriptionId: record.id,
        applicationFeeBps: target.feeBps,
        createdBy: target.actorId,
        linkedAt: now,
      })) !== null;
  if (!recorded) {
    return { kind: "already_linked" };
  }
  await store.links.appendAudit({
    actorId: target.actorId,
    action: target.inviteId ? "subscription.claimed" : "subscription.linked",
    target: userId,
    metadata: {
      externalSubscriptionId: summary.id,
      interval: target.interval,
      platformFeeBps: target.feeBps,
    },
  });
  return {
    kind: "linked",
    subscription: record,
    action: membershipSyncAction({
      membership: await store.findMember(userId),
      previous: null,
      next: accessState,
    }),
  };
}

export function linkFeeBps(
  runtime: Runtime,
  connection: ConnectionRecord,
  requested: boolean,
): number {
  return requested && splitsFees(runtime, connection) ? feeBpsFor(runtime, connection) : 0;
}

export async function finishLink(
  runtime: Runtime,
  communityId: CommunityId,
  connection: ConnectionRecord,
  applied: Extract<AppliedLink, { kind: "linked" }>,
  feeBps: number,
): Promise<boolean> {
  if (applied.action === "activate") {
    await runtime.repo.activateMembership(communityId, applied.subscription.userId, runtime.now());
  }
  if (feeBps <= 0 || applied.subscription.applicationFeeBps === feeBps) {
    return false;
  }
  const { provider, conn } = providerFor(runtime, connection);
  const setPlatformFee = provider.setPlatformFee?.bind(provider);
  if (!setPlatformFee) {
    return false;
  }
  const externalId = applied.subscription.externalSubscriptionId;
  try {
    const updated = await callStripe(runtime, () =>
      setPlatformFee(externalId, feeBps, `link:${connection.id}:${externalId}:fee:${feeBps}`, conn),
    );
    await runtime.repo.inCommunityAsSystem(communityId, (store) =>
      store.setSubscriptionFeeBps(
        applied.subscription.id,
        feeBpsFromPercent(updated.applicationFeePercent),
      ),
    );
    return (updated.applicationFeePercent ?? 0) > 0;
  } catch (error: unknown) {
    runtime.log({
      msg: "could not add the platform fee to a linked subscription",
      level: "warn",
      subscriptionId: externalId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
