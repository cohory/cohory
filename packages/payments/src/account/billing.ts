import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema, setRlsValue, type CommunityId, type Database } from "@cohory/db";
import { subscriptions, type PlanInterval } from "@cohory/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { accessEndAfterClose } from "../access";
import { exitEligibleStatuses } from "../exit/store";
import type {
  CommunityRecord,
  ConnectionRecord,
  PaymentsRepository,
  PlanRecord,
  SubscriptionRecord,
} from "../repository";
import { requireUserId } from "../service/context";
import { providerView } from "../views";

export type PaidMembershipBilling =
  { readonly kind: "portal" } | { readonly kind: "direct"; readonly supportContact: string | null };

export interface PaidMembershipRow {
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly planName: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly interval: PlanInterval | null;
  readonly providerStatus: string;
  readonly nextChargeAt: Date | null;
  readonly endsAt: Date | null;
  readonly billing: PaidMembershipBilling;
}

type OwnSubscription = Pick<
  SubscriptionRecord,
  | "communityId"
  | "connectionId"
  | "planId"
  | "providerStatus"
  | "accessState"
  | "interval"
  | "currentPeriodEnd"
  | "cancelAtPeriodEnd"
>;

interface CommunityDetails {
  readonly community: CommunityRecord;
  readonly plan: PlanRecord | null;
  readonly connection: ConnectionRecord | null;
  readonly supportContact: string | null;
}

export interface AccountBillingDeps {
  readonly db: Database;
  readonly repo: PaymentsRepository;
  readonly now: () => Date;
}

function amountFor(plan: PlanRecord | null, interval: PlanInterval | null): number | null {
  if (!plan) return null;
  if (interval === "year") return plan.annualPriceMinor;
  return plan.monthlyPriceMinor;
}

function shownUntil(
  subscription: OwnSubscription,
  connection: ConnectionRecord | null,
  now: Date,
): { readonly visible: boolean; readonly endsAt: Date | null } {
  if (connection?.status === "disconnected") {
    const end = accessEndAfterClose(subscription, connection.disconnectedAt ?? now);
    return { visible: end !== null && end > now, endsAt: end };
  }
  if (subscription.cancelAtPeriodEnd) {
    const end = subscription.currentPeriodEnd;
    return { visible: end === null || end > now, endsAt: end };
  }
  return { visible: true, endsAt: null };
}

export function createListMyPaidMemberships(deps: AccountBillingDeps) {
  async function ownSubscriptions(userId: string): Promise<OwnSubscription[]> {
    return deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", userId);
      return tx
        .select({
          communityId: subscriptions.communityId,
          connectionId: subscriptions.connectionId,
          planId: subscriptions.planId,
          providerStatus: subscriptions.providerStatus,
          accessState: subscriptions.accessState,
          interval: subscriptions.interval,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            inArray(subscriptions.providerStatus, [...exitEligibleStatuses]),
          ),
        )
        .orderBy(asc(subscriptions.createdAt));
    });
  }

  async function detailsFor(
    communityId: CommunityId,
    subscription: OwnSubscription,
  ): Promise<CommunityDetails | null> {
    const community = await deps.repo.findCommunity(communityId);
    if (!community) return null;
    return deps.repo.inCommunityAsSystem(communityId, async (store) => {
      const plan = subscription.planId ? await store.findPlan(subscription.planId) : null;
      const connection = await deps.repo.findConnectionById(subscription.connectionId);
      const contactId = connection?.acceptedOwnerId ?? (await store.findOwnerId());
      const supportContact = contactId ? await store.findUserEmail(contactId) : null;
      return { community, plan, connection, supportContact };
    });
  }

  return async function listMyPaidMemberships(actor: Actor): Promise<PaidMembershipRow[]> {
    const userId = requireUserId(actor);
    assertCan(actor, "read_own", "payment");
    const now = deps.now();
    const rows: PaidMembershipRow[] = [];
    for (const subscription of await ownSubscriptions(userId)) {
      const details = await detailsFor(
        communityIdSchema.parse(subscription.communityId),
        subscription,
      );
      if (!details) continue;
      const { community, plan, connection, supportContact } = details;
      const shown = shownUntil(subscription, connection, now);
      if (!shown.visible) continue;
      const open = connection !== null && connection.status !== "disconnected";
      const portal = open && providerView(connection.provider).customerPortal;
      rows.push({
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        planName: plan?.name ?? null,
        amountMinor: amountFor(plan, subscription.interval),
        currency: plan?.currency ?? null,
        interval: subscription.interval,
        providerStatus: subscription.providerStatus,
        nextChargeAt: open && shown.endsAt === null ? subscription.currentPeriodEnd : null,
        endsAt: shown.endsAt,
        billing: portal ? { kind: "portal" } : { kind: "direct", supportContact },
      });
    }
    return rows;
  };
}
