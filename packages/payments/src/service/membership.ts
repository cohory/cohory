import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";
import type { JoinAnswerJson, JoinQuestion } from "@cohory/db/schema";

import { hasAccess, resolveMembershipAccess, type MembershipAccess } from "../access";
import {
  AlreadySubscribedError,
  CommunityArchivedCheckoutError,
  IntervalUnavailableError,
  InviteRequiredError,
  NoBillingAccountError,
  NotConnectedError,
  PaidSignupsPausedError,
  PaymentsNotFoundError,
  PaymentsValidationError,
  PlanUnavailableError,
  StripeRejectedError,
} from "../errors";
import { requestKey } from "../idempotency";
import type { Connection, PaymentProvider } from "../providers/types";
import type {
  CommunityRecord,
  ConnectionRecord,
  MemberRecord,
  PaymentsStore,
  PlanRecord,
  SubscriptionRecord,
} from "../repository";
import { checkoutInputSchema, type CheckoutInput } from "../schemas";
import {
  isPurchasable,
  providerView,
  toPlanView,
  toSubscriptionView,
  type MyMembershipView,
  type PlanView,
  type RedirectView,
} from "../views";
import {
  assertProviderEnabled,
  callStripe,
  feeBpsFor,
  isProviderEnabled,
  parse,
  providerFor,
  requireAppUrl,
  requireUserId,
  timeBucket,
  withAccess,
  type Runtime,
} from "./context";
import { priceOf, yearlySwitch } from "./member-billing";
import { findPendingMove, movingWindow } from "./moves";

export interface PortalSessionOptions {
  readonly returnTo?: "membership" | "account";
}

export interface RejoinResult {
  readonly restored: boolean;
}

export interface MembershipOperations {
  createCheckoutSession(
    actor: Actor,
    communityId: string,
    input?: CheckoutInput,
  ): Promise<RedirectView>;
  createPortalSession(
    actor: Actor,
    communityId: string,
    options?: PortalSessionOptions,
  ): Promise<RedirectView>;
  rejoinWithPaidAccess(actor: Actor, communityId: string): Promise<RejoinResult>;
  getMyMembership(actor: Actor, communityId: string): Promise<MyMembershipView>;
  getMembershipAccess(communityId: string, userId: string): Promise<MembershipAccess>;
  hasActiveMembership(communityId: string, userId: string): Promise<boolean>;
}

async function accessFromStore(
  store: PaymentsStore,
  userId: string,
  now: Date,
): Promise<MembershipAccess> {
  const [membership, subscription, plan, comp] = await Promise.all([
    store.findMember(userId),
    store.findSubscriptionForUser(userId),
    store.findActivePlan(),
    store.comps.findOpen(userId),
  ]);
  const connectionClosedAt = subscription
    ? await store.findConnectionClosedAt(subscription.connectionId)
    : null;
  const emailBanned = membership?.status !== "active" && (await store.isEmailBanned(userId));
  return resolveMembershipAccess({
    paidPlanActive: plan !== null,
    membership: emailBanned ? { role: "member", status: "banned" } : membership,
    subscription: subscription ? { ...subscription, connectionClosedAt } : null,
    comp,
    now,
  });
}

function leftWithPaidAccess(member: MemberRecord | null, access: MembershipAccess): boolean {
  return (
    member?.status === "removed" && member.removalReason === "left" && access.level === "member"
  );
}

// An invite only community sells only to people who used an invite: redeeming one in a paid
// community leaves a pending membership that checkout completes.
export function needsInvite(
  community: CommunityRecord,
  member: MemberRecord | null,
  earlier: SubscriptionRecord | null,
): boolean {
  return (
    community.joinMode === "invite" &&
    earlier === null &&
    member?.status !== "pending" &&
    member?.status !== "active"
  );
}

// Join questions are for newcomers: someone who was a member or paid before answers nothing
// when they subscribe again. A pending row is an invite hold, not a past membership.
export function asksJoinQuestions(
  community: CommunityRecord,
  member: MemberRecord | null,
  earlier: SubscriptionRecord | null,
): boolean {
  const returning = earlier !== null || (member !== null && member.status !== "pending");
  return !returning && community.joinQuestions.length > 0;
}

export function pairJoinAnswers(
  questions: readonly JoinQuestion[],
  answers: readonly string[],
): JoinAnswerJson[] {
  const issues = questions.flatMap((question, index) =>
    question.required && !answers[index]
      ? [{ path: `answers.${index}`, message: "Answer this question to join." }]
      : [],
  );
  if (answers.length > questions.length) {
    issues.push({ path: "answers", message: "There are more answers than questions." });
  }
  if (issues.length > 0) {
    throw new PaymentsValidationError(issues);
  }
  return questions.map((question, index) => ({
    question: question.text,
    answer: answers[index] ?? "",
  }));
}

const minimumTrialMs = 48 * 60 * 60 * 1000;
const checkoutLifetimeMs = (24 * 60 - 5) * 60 * 1000;
const yearlySuggestionAfterMs = 59 * 24 * 60 * 60 * 1000;

export function resubscribeWindow(
  access: MembershipAccess,
  subscription: SubscriptionRecord | null,
): { endsAt: Date } | null {
  if (
    access.level !== "member" ||
    access.source !== "subscription" ||
    !access.cancelAtPeriodEnd ||
    !access.currentPeriodEnd ||
    subscription?.origin !== "linked_import"
  ) {
    return null;
  }
  return { endsAt: access.currentPeriodEnd };
}

function trialUntil(ending: { endsAt: Date } | null, now: Date): Date | null {
  if (!ending) {
    return null;
  }
  return ending.endsAt.getTime() - now.getTime() > minimumTrialMs ? ending.endsAt : null;
}

export function createMembershipOperations(runtime: Runtime): MembershipOperations {
  function sellableView(
    plan: PlanRecord,
    connection: ConnectionRecord | null,
    ownerId: string | null,
    archived: boolean,
  ): PlanView {
    const view = toPlanView(plan, connection, ownerId);
    if (archived || (connection && !isProviderEnabled(runtime.env, connection.provider))) {
      return { ...view, purchasable: false };
    }
    return view;
  }

  async function getMembershipAccess(
    communityId: string,
    userId: string,
  ): Promise<MembershipAccess> {
    const parsed = communityIdSchema.safeParse(communityId);
    if (!parsed.success) {
      throw new PaymentsNotFoundError("community");
    }
    return runtime.repo.inCommunity(parsed.data, userId, (store) =>
      accessFromStore(store, userId, runtime.now()),
    );
  }

  async function expireOtherCheckouts(
    provider: PaymentProvider,
    conn: Connection,
    keepExternalId: string,
    customerId: string | null,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    const expire = provider.expireOtherCheckouts?.bind(provider);
    if (!expire) {
      return;
    }
    try {
      await callStripe(runtime, () =>
        expire({ keepExternalId, customerId, metadata }, `checkout-expire:${keepExternalId}`, conn),
      );
    } catch (error: unknown) {
      if (!(error instanceof StripeRejectedError)) {
        throw error;
      }
      runtime.log({
        msg: "could not expire an older checkout session",
        level: "warn",
        sessionId: keepExternalId,
        code: error.stripeCode,
      });
    }
  }

  return {
    async createCheckoutSession(actor, communityId, input = {}) {
      const userId = requireUserId(actor);
      const appUrl = requireAppUrl(runtime);
      const { interval, answers } = parse(checkoutInputSchema, input);
      const move = await findPendingMove(runtime, communityId, userId);
      const prepared = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, member, context }) => {
          if (member?.status === "banned" || (await store.isEmailBanned(userId))) {
            throw new ForbiddenError("purchase", "payment");
          }
          if (community.archived) {
            throw new CommunityArchivedCheckoutError();
          }
          const now = runtime.now();
          const current = await accessFromStore(store, userId, now);
          const earlier = await store.findSubscriptionForUser(userId);
          const ending = resubscribeWindow(current, earlier) ?? movingWindow(move, current, now);
          if (hasAccess(current) && !ending) {
            throw new AlreadySubscribedError();
          }
          assertCan(actor, "purchase", "payment", context);
          if (needsInvite(community, member, earlier)) {
            throw new InviteRequiredError();
          }
          const joinAnswers = asksJoinQuestions(community, member, earlier)
            ? pairJoinAnswers(community.joinQuestions, answers)
            : [];
          const plan = await store.findActivePlan();
          if (!plan) {
            throw new PlanUnavailableError();
          }
          const connection = await store.findOpenConnection();
          if (!connection) {
            throw new NotConnectedError();
          }
          assertProviderEnabled(runtime, connection.provider);
          if (!isPurchasable(plan, connection, await store.findOwnerId())) {
            throw new NotConnectedError();
          }
          const priceId =
            interval === "year" ? plan.providerAnnualPriceId : plan.providerMonthlyPriceId;
          if (!priceId) {
            throw new IntervalUnavailableError();
          }
          const customer = await store.findCustomer(userId, connection.id);
          const email = customer ? null : await store.findUserEmail(userId);
          const trialEnd = trialUntil(ending, now);
          await store.savePendingJoinAnswers(userId, joinAnswers);
          return { community, plan, connection, priceId, customer, email, trialEnd };
        },
      );
      const { community, plan, connection, priceId, customer, email, trialEnd } = prepared;
      const { provider, conn } = providerFor(runtime, connection);
      const accruesFees =
        !provider.capabilities(conn).supportsFeeSplit && feeBpsFor(runtime, connection) > 0;
      if (accruesFees && (await runtime.isBillingSuspended(community.id))) {
        throw new PaidSignupsPausedError();
      }
      const back = `${appUrl}/c/${community.slug}/membership`;
      const request = {
        priceId,
        customerId: customer?.externalCustomerId ?? null,
        customerEmail: email,
        clientReferenceId: userId,
        metadata: {
          cohory_community_id: community.id,
          cohory_user_id: userId,
          cohory_plan_id: plan.id,
        },
        platformFeeBps: feeBpsFor(runtime, connection),
        trialEnd,
        expiresAt: new Date(runtime.now().getTime() + checkoutLifetimeMs),
        submitMessage: `Cancel anytime from your membership page in ${community.name}.`,
        successUrl: `${back}?checkout=success`,
        cancelUrl: `${back}?checkout=cancel`,
      };
      const session = await callStripe(runtime, () =>
        provider.createCheckout(
          {
            ...request,
            idempotencyKey: `checkout:${plan.id}:${userId}:${interval}:${runtime.newId()}`,
          },
          conn,
        ),
      );
      await expireOtherCheckouts(provider, conn, session.externalId, request.customerId, {
        cohory_community_id: community.id,
        cohory_user_id: userId,
      });
      await runtime.repo.inCommunityAsSystem(community.id, (store) =>
        store.holds.extend(userId, request.expiresAt),
      );
      return { url: session.url };
    },

    async createPortalSession(actor, communityId, options) {
      const userId = requireUserId(actor);
      const appUrl = requireAppUrl(runtime);
      const { community, connection, customerId } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "read_own", "payment", context);
          const connection = await store.findOpenConnection();
          if (!connection) {
            throw new NotConnectedError();
          }
          const customer = await store.findCustomer(userId, connection.id);
          if (!customer) {
            throw new NoBillingAccountError();
          }
          return { community, connection, customerId: customer.externalCustomerId };
        },
      );
      const { provider, conn } = providerFor(runtime, connection);
      const returnTo = options?.returnTo ?? "membership";
      const returnUrl =
        returnTo === "account"
          ? `${appUrl}/account/billing`
          : `${appUrl}/c/${community.slug}/membership`;
      const session = await callStripe(runtime, () =>
        provider.createPortalSession(
          customerId,
          returnUrl,
          requestKey(
            `portal:${connection.id}:${customerId}:${returnTo}:${timeBucket(runtime.now(), 5)}`,
            { returnUrl },
          ),
          conn,
        ),
      );
      return { url: session.url };
    },

    async rejoinWithPaidAccess(actor, communityId) {
      const userId = requireUserId(actor);
      const { eligible, scope } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, member, context }) => {
          if (member?.status === "banned" || (await store.isEmailBanned(userId))) {
            throw new ForbiddenError("join", "membership");
          }
          assertCan(actor, "join", "membership", context);
          if (community.archived) {
            throw new CommunityArchivedCheckoutError();
          }
          const access = await accessFromStore(store, userId, runtime.now());
          return { eligible: leftWithPaidAccess(member, access), scope: community.id };
        },
      );
      if (!eligible) {
        return { restored: false };
      }
      return { restored: await runtime.repo.restoreLeftMembership(scope, userId, runtime.now()) };
    },

    async getMyMembership(actor, communityId) {
      const userId = requireUserId(actor);
      const move = await findPendingMove(runtime, communityId, userId);
      const { communityId: scope, ...view } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, member, context }) => {
          assertCan(actor, "read_own", "payment", context);
          const [access, plan, subscription, connection, ownerId] = await Promise.all([
            accessFromStore(store, userId, runtime.now()),
            store.findActivePlan(),
            store.findSubscriptionForUser(userId),
            store.findOpenConnection(),
            store.findOwnerId(),
          ]);
          const [customer, subscribedPlan] = await Promise.all([
            connection ? store.findCustomer(userId, connection.id) : null,
            subscription?.planId ? store.findPlan(subscription.planId) : null,
          ]);
          const price = priceOf(subscription, subscribedPlan);
          const yearly = yearlySwitch(price, plan);
          const resubscribe = plan
            ? (resubscribeWindow(access, subscription) ?? movingWindow(move, access, runtime.now()))
            : null;
          return {
            access,
            plan: plan ? sellableView(plan, connection, ownerId, community.archived) : null,
            subscription: subscription ? toSubscriptionView(subscription) : null,
            canManageBilling:
              customer !== null &&
              connection !== null &&
              providerView(connection.provider).customerPortal,
            resubscribe,
            provider: connection ? providerView(connection.provider) : null,
            communityArchived: community.archived,
            canRejoin: !community.archived && leftWithPaidAccess(member, access),
            inviteRequired: needsInvite(community, member, subscription),
            asksJoinQuestions: asksJoinQuestions(community, member, subscription),
            supportContact: null,
            price,
            yearly,
            suggestYearly:
              yearly !== null &&
              access.level === "member" &&
              subscription !== null &&
              runtime.now().getTime() - subscription.createdAt.getTime() >= yearlySuggestionAfterMs,
            paused: subscription?.providerStatus === "paused",
            communityId: community.id,
          };
        },
      );
      if (view.access.level !== "payment_required" || view.access.reason !== "billing_closed") {
        return view;
      }
      const supportContact = await runtime.repo.inCommunityAsSystem(scope, async (store) => {
        const ownerId = await store.findOwnerId();
        return ownerId ? store.findUserEmail(ownerId) : null;
      });
      return { ...view, supportContact };
    },

    getMembershipAccess,

    async hasActiveMembership(communityId, userId) {
      return hasAccess(await getMembershipAccess(communityId, userId));
    },
  };
}
