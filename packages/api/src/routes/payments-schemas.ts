import { z } from "@hono/zod-openapi";
import { isStripePortalLoginUrl } from "@cohory/payments";
import type {
  ConnectionView,
  ExitRunView,
  LedgerSummary,
  MembershipAccess,
  MyMembershipView,
  OwnershipReview,
  PaidMembersSummary,
  PaymentsOverview,
  PlanView,
  SubscriptionListItem,
  SubscriptionView,
} from "@cohory/payments";

import { pageCursor } from "../pagination";

export const communityIdParams = z.object({
  communityId: z.uuid().openapi({ param: { name: "communityId", in: "path" } }),
});

const isoDate = z.string().openapi({ format: "date-time" });
const minor = z.number().int().openapi({ description: "Integer amount in minor units (cents)." });
const currency = z.string().openapi({ example: "usd", description: "ISO 4217 code, lowercase." });

const providerEnum = z.enum(["stripe_connect", "stripe_own_keys", "polar"]);

export const connectionSchema = z
  .object({
    id: z.uuid(),
    provider: providerEnum,
    status: z.enum(["onboarding", "active", "restricted", "disconnecting", "disconnected"]),
    externalAccountId: z.string().nullable(),
    chargesEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
    livemode: z.boolean(),
    webhookPath: z.string().nullable().openapi({
      description:
        "Own keys and bring your own providers: the path to register as a webhook endpoint.",
    }),
    providerName: z.string(),
    feeSplit: z
      .boolean()
      .openapi({ description: "Whether the provider collects the platform fee at charge time." }),
    customerPortal: z.boolean(),
    webhookSecretSaved: z.boolean(),
    lastWebhookAt: isoDate.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .openapi("PaymentConnection");

export const overviewSchema = z
  .object({
    edition: z.enum(["cloud", "community"]),
    platformFeeBps: z.number().int().openapi({ description: "Platform fee in basis points." }),
    providers: z.array(providerEnum),
    connection: connectionSchema.nullable(),
    polarRetired: z.boolean().openapi({
      description:
        "True when the open connection is Polar and this server no longer offers Polar. New checkouts are refused until the owner connects Stripe.",
    }),
  })
  .openapi("PaymentsOverview");

export const planSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currency,
    monthlyPriceMinor: minor,
    annualPriceMinor: minor.nullable(),
    purchasable: z.boolean(),
    providerName: z.string().nullable(),
    archivedAt: isoDate.nullable(),
    createdAt: isoDate,
  })
  .openapi("MembershipPlan");

export const planResponseSchema = z
  .object({ plan: planSchema.nullable() })
  .openapi("MembershipPlanResponse");

export const upsertPlanBodySchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    monthlyPriceMinor: z.number().int().min(1),
    annualPriceMinor: z.number().int().min(1).nullable().optional(),
  })
  .openapi("UpsertMembershipPlan");

export const connectBodySchema = z
  .object({
    email: z.email().nullable().optional(),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .nullable()
      .optional()
      .openapi({
        description:
          "Two letter country of the creator's business. Stripe creates the account for this country; when omitted, the platform's country is used.",
        example: "DE",
      }),
    acceptCreatorTerms: z.boolean().optional().openapi({
      description:
        "Cloud only. True when the person connecting accepts the current Creator Terms and Data Processing Agreement. Without it, connecting fails with creator_terms_required until they accepted the current version.",
    }),
  })
  .openapi("ConnectStripe");

export const ownKeysBodySchema = z
  .object({
    secretKey: z.string().openapi({ example: "rk_test_..." }),
    webhookSecret: z.string().openapi({ example: "whsec_..." }),
  })
  .openapi("ConnectOwnStripeKeys");

export const disconnectBodySchema = z
  .object({
    memberChoice: z.enum(["take_members", "wind_down"]).optional().openapi({
      description:
        "take_members (default) keeps subscriptions billing on the creator's Stripe account without the platform fee. wind_down sets every subscription to end at its period end.",
    }),
    includeLinked: z.boolean().optional().openapi({
      description: "Include subscriptions linked from before Cohory in wind down. Default true.",
    }),
    portalLoginUrl: z
      .string()
      .max(500)
      .refine(
        isStripePortalLoginUrl,
        "Use your Stripe customer portal link from billing.stripe.com",
      )
      .nullable()
      .optional()
      .openapi({
        description:
          "Optional Stripe customer portal login link that members get in their email. Only https://billing.stripe.com/p/login/ links are accepted.",
        example: "https://billing.stripe.com/p/login/test_abc",
      }),
  })
  .openapi("DisconnectPayments");

export const checkoutBodySchema = z
  .object({
    interval: z.enum(["month", "year"]).optional(),
    answers: z.array(z.string().max(1000)).max(3).optional().openapi({
      description:
        "Answers to the community's join questions, in question order. Required questions must be answered before checkout.",
    }),
  })
  .openapi("CreateCheckout");

export const redirectSchema = z.object({ url: z.url() }).openapi("PaymentRedirect");

export const connectResponseSchema = z
  .object({ url: z.url(), connection: connectionSchema })
  .openapi("ConnectStripeResponse");

const subscriptionFields = {
  id: z.uuid(),
  providerStatus: z.string(),
  accessState: z.enum(["none", "granted", "grace", "revoked"]),
  interval: z.enum(["month", "year"]).nullable(),
  currentPeriodEnd: isoDate.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  endedAt: isoDate.nullable(),
  createdAt: isoDate,
};

export const subscriptionSchema = z.object(subscriptionFields).openapi("Subscription");

export const subscriptionListSchema = z
  .object({
    data: z.array(
      z
        .object({
          ...subscriptionFields,
          userId: z.uuid(),
          userName: z.string(),
          userEmail: z.string(),
        })
        .openapi("SubscriptionListItem"),
    ),
    ...pageCursor,
  })
  .openapi("SubscriptionList");

export const accessSchema = z
  .object({
    level: z.enum(["banned", "staff", "member", "payment_required", "not_member"]),
    role: z.enum(["owner", "admin", "moderator", "member"]).optional(),
    source: z.enum(["subscription", "comp", "membership"]).optional(),
    state: z.enum(["granted", "grace"]).optional(),
    reason: z.enum(["no_subscription", "incomplete", "ended", "billing_closed"]).optional(),
    currentPeriodEnd: isoDate.nullable().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    expiresAt: isoDate
      .nullable()
      .optional()
      .openapi({ description: "When comped access ends; null means it does not end." }),
  })
  .openapi("MembershipAccess");

export const myMembershipSchema = z
  .object({
    access: accessSchema,
    plan: planSchema.nullable(),
    subscription: subscriptionSchema.nullable(),
    canManageBilling: z.boolean(),
    communityArchived: z.boolean(),
    supportContact: z.string().nullable().openapi({
      description:
        "Who to contact about billing. Set only when paid access ended because the creator disconnected payments.",
    }),
    provider: z
      .object({ id: providerEnum, name: z.string(), customerPortal: z.boolean() })
      .nullable(),
  })
  .openapi("MyPaidMembership");

export const ledgerSummarySchema = z
  .object({
    edition: z.enum(["cloud", "community"]),
    platformFeeBps: z.number().int(),
    currencies: z.array(
      z
        .object({
          currency,
          paymentCount: z.number().int(),
          grossMinor: minor,
          refundedMinor: minor,
          taxMinor: minor,
          platformFeeMinor: minor,
          platformFeeRefundedMinor: minor,
          netPlatformFeeMinor: minor,
        })
        .openapi("LedgerCurrencySummary"),
    ),
  })
  .openapi("LedgerSummary");

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function connectionJson(connection: ConnectionView): z.infer<typeof connectionSchema> {
  return {
    ...connection,
    lastWebhookAt: iso(connection.lastWebhookAt),
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export function overviewJson(overview: PaymentsOverview): z.infer<typeof overviewSchema> {
  return {
    ...overview,
    providers: [...overview.providers],
    connection: overview.connection ? connectionJson(overview.connection) : null,
  };
}

export function planJson(plan: PlanView): z.infer<typeof planSchema> {
  return { ...plan, archivedAt: iso(plan.archivedAt), createdAt: plan.createdAt.toISOString() };
}

export function subscriptionJson(
  subscription: SubscriptionView,
): z.infer<typeof subscriptionSchema> {
  return {
    id: subscription.id,
    providerStatus: subscription.providerStatus,
    accessState: subscription.accessState,
    interval: subscription.interval,
    currentPeriodEnd: iso(subscription.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    endedAt: iso(subscription.endedAt),
    createdAt: subscription.createdAt.toISOString(),
  };
}

export function subscriptionListJson(
  items: readonly SubscriptionListItem[],
): z.infer<typeof subscriptionListSchema> {
  return {
    data: items.map((item) => ({
      ...subscriptionJson(item),
      userId: item.userId,
      userName: item.userName,
      userEmail: item.userEmail,
    })),
    nextCursor: null,
  };
}

export function accessJson(access: MembershipAccess): z.infer<typeof accessSchema> {
  switch (access.level) {
    case "member":
      return access.source === "subscription"
        ? {
            level: access.level,
            source: access.source,
            state: access.state,
            currentPeriodEnd: iso(access.currentPeriodEnd),
            cancelAtPeriodEnd: access.cancelAtPeriodEnd,
          }
        : access.source === "comp"
          ? { level: access.level, source: access.source, expiresAt: iso(access.expiresAt) }
          : { level: access.level, source: access.source };
    case "staff":
      return { level: access.level, role: access.role };
    case "payment_required":
      return { level: access.level, reason: access.reason };
    case "banned":
    case "not_member":
      return { level: access.level };
  }
}

export function myMembershipJson(view: MyMembershipView): z.infer<typeof myMembershipSchema> {
  return {
    access: accessJson(view.access),
    plan: view.plan ? planJson(view.plan) : null,
    subscription: view.subscription ? subscriptionJson(view.subscription) : null,
    canManageBilling: view.canManageBilling,
    communityArchived: view.communityArchived,
    supportContact: view.supportContact,
    provider: view.provider,
  };
}

export function ledgerSummaryJson(summary: LedgerSummary): z.infer<typeof ledgerSummarySchema> {
  return { ...summary, currencies: summary.currencies.map((entry) => ({ ...entry })) };
}

export const exitRunSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["archive", "disconnect", "delete"]),
    choice: z.enum([
      "stop_at_period_end",
      "keep_billing",
      "take_members",
      "wind_down",
      "cancel_now",
    ]),
    status: z.enum(["pending", "running", "failed", "done"]),
    includeLinked: z.boolean(),
    targetCount: z.number().int(),
    doneCount: z.number().int(),
    failedCount: z.number().int(),
    failedMembers: z.array(z.object({ userId: z.uuid(), name: z.string() })),
    createdAt: isoDate,
    finishedAt: isoDate.nullable(),
  })
  .openapi("PaidMembersExitRun");

export const paidMembersSchema = z
  .object({
    connection: z.enum(["none", "open", "disconnecting", "closed"]),
    cohory: z.number().int().openapi({ description: "Paying members who joined through Cohory." }),
    linkedImports: z
      .number()
      .int()
      .openapi({ description: "Subscriptions linked from before Cohory." }),
    endingAtPeriodEnd: z
      .number()
      .int()
      .openapi({ description: "Subscriptions set to end at the period end." }),
    manualCancellation: z.number().int().openapi({
      description:
        "Subscriptions on a closed connection that the owner must cancel in the Stripe Dashboard and confirm before deleting the community. Zero when deletion needs no confirmation.",
    }),
    run: exitRunSchema.nullable(),
  })
  .openapi("PaidMembersSummary");

export const ownershipReviewSchema = z
  .object({
    review: z
      .object({
        previousOwnerName: z.string().nullable(),
        provider: providerEnum,
        cohory: z
          .number()
          .int()
          .openapi({ description: "Paying members who joined through Cohory." }),
        linkedImports: z
          .number()
          .int()
          .openapi({ description: "Subscriptions linked from before Cohory." }),
      })
      .nullable(),
  })
  .openapi("PaymentOwnershipReview");

export function ownershipReviewJson(
  review: OwnershipReview | null,
): z.infer<typeof ownershipReviewSchema> {
  return { review: review ? { ...review } : null };
}

export function exitRunJson(run: ExitRunView): z.infer<typeof exitRunSchema> {
  return {
    ...run,
    failedMembers: [...run.failedMembers],
    createdAt: run.createdAt.toISOString(),
    finishedAt: iso(run.finishedAt),
  };
}

export function paidMembersJson(summary: PaidMembersSummary): z.infer<typeof paidMembersSchema> {
  return { ...summary, run: summary.run ? exitRunJson(summary.run) : null };
}
