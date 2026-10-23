import { assertCan, type Actor } from "@cohory/authz";
import type { MemberUsage } from "@cohory/db";
import { z } from "zod";

import { resolveMembershipAccess, type MembershipAccess } from "../access";
import { MembershipChangeUnavailableError, NoBillingAccountError } from "../errors";
import type { CancellationFeedback, PortalFlow } from "../gateway";
import { requestKey } from "../idempotency";
import type {
  CommunityRecord,
  ConnectionRecord,
  PaymentsStore,
  PlanRecord,
  SubscriptionRecord,
} from "../repository";
import type { RedirectView } from "../views";
import {
  callStripe,
  parse,
  providerFor,
  requireAppUrl,
  requireUserId,
  timeBucket,
  withAccess,
  type Runtime,
} from "./context";
import { createNormalizedEventHandler } from "./normalized-events";

export const pauseMonthChoices = [1, 2, 3] as const;
export const cancelCommentMaxLength = 500;

const cancellationFeedback = [
  "too_expensive",
  "unused",
  "missing_features",
  "low_quality",
  "customer_service",
  "switched_service",
  "too_complex",
  "other",
] as const satisfies readonly CancellationFeedback[];

export const cancelMembershipInputSchema = z.object({
  feedback: z.enum(cancellationFeedback).nullable().default(null),
  comment: z
    .string()
    .trim()
    .max(cancelCommentMaxLength)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});

export const pauseMembershipInputSchema = z.object({
  months: z.union(pauseMonthChoices.map((months) => z.literal(months))),
});

export type CancelMembershipInput = z.input<typeof cancelMembershipInputSchema>;
export type PauseMembershipInput = z.input<typeof pauseMembershipInputSchema>;

export interface MembershipPriceView {
  readonly amountMinor: number;
  readonly currency: string;
  readonly interval: "month" | "year";
}

export interface YearlySwitchView {
  readonly annualPriceMinor: number;
  readonly savingMinor: number;
  readonly currency: string;
}

export interface CancelOverview {
  readonly communityName: string;
  readonly accessEndsAt: Date | null;
  readonly usage: MemberUsage;
  readonly price: MembershipPriceView | null;
  readonly yearly: YearlySwitchView | null;
  readonly canPause: boolean;
}

export interface PauseResult {
  readonly accessUntil: Date;
  readonly resumesAt: Date;
}

export interface MemberBillingOperations {
  getCancelOverview(actor: Actor, communityId: string): Promise<CancelOverview>;
  cancelMembership(
    actor: Actor,
    communityId: string,
    input?: CancelMembershipInput,
  ): Promise<RedirectView>;
  switchToYearly(actor: Actor, communityId: string): Promise<RedirectView>;
  pauseMembership(
    actor: Actor,
    communityId: string,
    input: PauseMembershipInput,
  ): Promise<PauseResult>;
  resumeMembership(actor: Actor, communityId: string): Promise<void>;
}

export function priceOf(
  subscription: SubscriptionRecord | null,
  plan: PlanRecord | null,
): MembershipPriceView | null {
  if (!subscription || !plan || !subscription.interval) {
    return null;
  }
  const amountMinor =
    subscription.interval === "year" ? plan.annualPriceMinor : plan.monthlyPriceMinor;
  return amountMinor === null
    ? null
    : { amountMinor, currency: plan.currency, interval: subscription.interval };
}

export function yearlySwitch(
  price: MembershipPriceView | null,
  active: PlanRecord | null,
): YearlySwitchView | null {
  if (
    price?.interval !== "month" ||
    !active?.annualPriceMinor ||
    !active.providerAnnualPriceId ||
    active.currency !== price.currency
  ) {
    return null;
  }
  const savingMinor = price.amountMinor * 12 - active.annualPriceMinor;
  return savingMinor > 0
    ? { annualPriceMinor: active.annualPriceMinor, savingMinor, currency: active.currency }
    : null;
}

function payingAccess(
  access: MembershipAccess,
): access is Extract<MembershipAccess, { level: "member"; source: "subscription" }> {
  return access.level === "member" && access.source === "subscription";
}

export function canPause(
  access: MembershipAccess,
  subscription: SubscriptionRecord | null,
  pausable: boolean,
): boolean {
  return (
    pausable &&
    payingAccess(access) &&
    access.state === "granted" &&
    !access.cancelAtPeriodEnd &&
    subscription?.providerStatus === "active" &&
    subscription.interval === "month" &&
    subscription.currentPeriodEnd !== null
  );
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function stateKey(operation: string, subscription: SubscriptionRecord): string {
  return `${operation}:${subscription.id}:${subscription.updatedAt.getTime()}`;
}

interface OwnBilling {
  readonly community: CommunityRecord;
  readonly connection: ConnectionRecord;
  readonly subscription: SubscriptionRecord;
  readonly customerId: string;
  readonly access: MembershipAccess;
  readonly price: MembershipPriceView | null;
  readonly active: PlanRecord | null;
}

async function accessOf(
  store: PaymentsStore,
  userId: string,
  subscription: SubscriptionRecord,
  now: Date,
): Promise<MembershipAccess> {
  const connectionClosedAt = await store.findConnectionClosedAt(subscription.connectionId);
  return resolveMembershipAccess({
    paidPlanActive: true,
    membership: null,
    subscription: { ...subscription, connectionClosedAt },
    comp: null,
    now,
  });
}

export function createMemberBillingOperations(runtime: Runtime): MemberBillingOperations {
  const syncAfterChange = createNormalizedEventHandler(runtime);

  async function ownBilling(
    actor: Actor,
    communityId: string,
    change: MembershipChangeUnavailableError["change"],
  ): Promise<OwnBilling> {
    const userId = requireUserId(actor);
    return withAccess(runtime, actor, communityId, async ({ store, community, context }) => {
      assertCan(actor, "read_own", "payment", context);
      const subscription = await store.findSubscriptionForUser(userId);
      const connection = await store.findOpenConnection();
      if (!subscription || !connection || subscription.connectionId !== connection.id) {
        throw new MembershipChangeUnavailableError(change);
      }
      const customer = await store.findCustomer(userId, connection.id);
      if (!customer) {
        throw new NoBillingAccountError();
      }
      const [plan, active, access] = await Promise.all([
        subscription.planId ? store.findPlan(subscription.planId) : null,
        store.findActivePlan(),
        accessOf(store, userId, subscription, runtime.now()),
      ]);
      return {
        community,
        connection,
        subscription,
        customerId: customer.externalCustomerId,
        access,
        price: priceOf(subscription, plan),
        active,
      };
    });
  }

  async function portal(own: OwnBilling, flow: PortalFlow, key: string): Promise<RedirectView> {
    const returnUrl = `${requireAppUrl(runtime)}/c/${own.community.slug}/membership`;
    const { provider, conn } = providerFor(runtime, own.connection);
    const session = await callStripe(runtime, () =>
      provider.createPortalSession(
        own.customerId,
        returnUrl,
        requestKey(`${key}:${own.subscription.id}:${timeBucket(runtime.now(), 5)}`, {
          returnUrl,
          flow,
        }),
        conn,
        flow,
      ),
    );
    return { url: session.url };
  }

  async function resync(own: OwnBilling): Promise<void> {
    const { provider, conn } = providerFor(runtime, own.connection);
    await syncAfterChange(
      { connection: own.connection, communityId: own.community.id, provider, conn },
      { kind: "subscription_changed", subscriptionId: own.subscription.externalSubscriptionId },
    );
  }

  function pausable(own: Pick<OwnBilling, "connection">): boolean {
    return providerFor(runtime, own.connection).provider.pauseSubscription !== undefined;
  }

  return {
    async getCancelOverview(actor, communityId) {
      const own = await ownBilling(actor, communityId, "cancel");
      if (!payingAccess(own.access) || own.access.cancelAtPeriodEnd) {
        throw new MembershipChangeUnavailableError("cancel");
      }
      const userId = requireUserId(actor);
      const usage = await runtime.repo.inCommunity(own.community.id, userId, (store) =>
        store.memberUsage(userId, runtime.now()),
      );
      return {
        communityName: own.community.name,
        accessEndsAt: own.access.currentPeriodEnd,
        usage,
        price: own.price,
        yearly: yearlySwitch(own.price, own.active),
        canPause: canPause(own.access, own.subscription, pausable(own)),
      };
    },

    async cancelMembership(actor, communityId, input = {}) {
      const { feedback, comment } = parse(cancelMembershipInputSchema, input);
      const own = await ownBilling(actor, communityId, "cancel");
      if (!payingAccess(own.access) || own.access.cancelAtPeriodEnd) {
        throw new MembershipChangeUnavailableError("cancel");
      }
      const externalId = own.subscription.externalSubscriptionId;
      const { provider, conn } = providerFor(runtime, own.connection);
      const record = provider.recordCancellationDetails?.bind(provider);
      if (record && (feedback || comment)) {
        await callStripe(runtime, () =>
          record(
            externalId,
            { feedback, comment },
            requestKey(stateKey("cancel-reason", own.subscription), {
              feedback,
              comment,
            }),
            conn,
          ),
        );
      }
      return portal(
        own,
        { type: "subscription_cancel", subscriptionId: externalId },
        "portal-cancel",
      );
    },

    async switchToYearly(actor, communityId) {
      const own = await ownBilling(actor, communityId, "switch_to_yearly");
      const yearly = yearlySwitch(own.price, own.active);
      const priceId = own.active?.providerAnnualPriceId;
      if (!payingAccess(own.access) || !yearly || !priceId) {
        throw new MembershipChangeUnavailableError("switch_to_yearly");
      }
      const externalId = own.subscription.externalSubscriptionId;
      return portal(
        own,
        { type: "subscription_update_confirm", subscriptionId: externalId, priceId },
        "portal-yearly",
      );
    },

    async pauseMembership(actor, communityId, input) {
      const { months } = parse(pauseMembershipInputSchema, input);
      const own = await ownBilling(actor, communityId, "pause");
      const paidThrough = own.subscription.currentPeriodEnd;
      const { provider, conn } = providerFor(runtime, own.connection);
      const pause = provider.pauseSubscription?.bind(provider);
      if (!pause || !paidThrough || !canPause(own.access, own.subscription, true)) {
        throw new MembershipChangeUnavailableError("pause");
      }
      const resumesAt = addMonths(paidThrough, months);
      const externalId = own.subscription.externalSubscriptionId;
      await callStripe(runtime, () =>
        pause(
          externalId,
          { resumesAt, paidThrough },
          requestKey(stateKey("pause", own.subscription), {
            months,
            paidThrough: paidThrough.toISOString(),
          }),
          conn,
        ),
      );
      await resync(own);
      return { accessUntil: paidThrough, resumesAt };
    },

    async resumeMembership(actor, communityId) {
      const own = await ownBilling(actor, communityId, "resume");
      const { provider, conn } = providerFor(runtime, own.connection);
      const resume = provider.resumeSubscription?.bind(provider);
      if (!resume || own.subscription.providerStatus !== "paused") {
        throw new MembershipChangeUnavailableError("resume");
      }
      const externalId = own.subscription.externalSubscriptionId;
      await callStripe(runtime, () =>
        resume(externalId, requestKey(stateKey("resume", own.subscription), {}), conn),
      );
      await resync(own);
    },
  };
}
