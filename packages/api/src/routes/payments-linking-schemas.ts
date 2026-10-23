import { z } from "@hono/zod-openapi";
import type {
  DiscoveredSubscriber,
  LinkResult,
  SubscriberDiscovery,
  SubscriptionLinkView,
} from "@cohory/payments";

import { pageCursor } from "../pagination";

const isoDate = z.string().openapi({ format: "date-time" });
const minor = z.number().int().openapi({ description: "Integer amount in minor units (cents)." });
const currency = z.string().openapi({ example: "usd", description: "ISO 4217 code, lowercase." });
const stripeSubscriptionId = z
  .string()
  .regex(/^sub_[A-Za-z0-9_]+$/)
  .openapi({ example: "sub_1Q2w3e4r5t6y7u8i" });
const planInterval = z.enum(["month", "year"]);
const linkAction = z.enum(["link_member", "link_and_add", "invite", "skip"]);
const subscriberBlock = z.enum([
  "already_linked",
  "invited",
  "other_platform",
  "no_email",
  "banned",
  "customer_conflict",
]);

export const discoverQuerySchema = z.object({
  cursor: stripeSubscriptionId.optional().openapi({
    param: { name: "cursor", in: "query" },
    description: "The nextCursor of the previous page.",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: 50 }),
});

const subscriberMatchSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("member"), userId: z.uuid(), name: z.string() }),
    z.object({ kind: z.literal("user"), userId: z.uuid(), name: z.string() }),
    z.object({ kind: z.literal("unverified") }),
    z.object({ kind: z.literal("none") }),
  ])
  .openapi("SubscriberMatch");

export const discoveredSubscriberSchema = z
  .object({
    subscriptionId: stripeSubscriptionId,
    customerId: z.string(),
    email: z.string().nullable(),
    customerName: z.string().nullable(),
    status: z.string().openapi({ example: "active" }),
    priceId: z.string().nullable(),
    unitAmountMinor: minor.nullable(),
    currency,
    interval: z.string().nullable().openapi({ description: "The Stripe price interval." }),
    intervalCount: z.number().int(),
    currentPeriodEnd: isoDate.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    match: subscriberMatchSchema,
    block: subscriberBlock
      .nullable()
      .openapi({ description: "Why the subscription can only be skipped, or null." }),
    proposed: linkAction,
    allowed: z.array(linkAction),
    suggestedInterval: planInterval.nullable(),
  })
  .openapi("DiscoveredSubscriber");

export const subscriberDiscoverySchema = z
  .object({
    data: z.array(discoveredSubscriberSchema),
    nextCursor: stripeSubscriptionId.nullable(),
    plan: z
      .object({
        name: z.string(),
        currency,
        monthlyPriceMinor: minor,
        annualPriceMinor: minor.nullable(),
      })
      .nullable(),
    edition: z.enum(["cloud", "community"]),
    platformFeeBps: z.number().int().openapi({ description: "Platform fee in basis points." }),
    canAddPlatformFee: z.boolean(),
  })
  .openapi("SubscriberDiscovery");

export const linkSubscribersBodySchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            subscriptionId: stripeSubscriptionId,
            action: linkAction,
            interval: planInterval.nullable().optional(),
          })
          .refine((row) => row.action === "skip" || Boolean(row.interval), {
            path: ["interval"],
            message: "Choose monthly or yearly for every subscription you link or invite.",
          }),
      )
      .min(1)
      .max(100),
    addPlatformFee: z.boolean().optional().openapi({
      description: "Cloud only. Adds the platform fee to the linked subscriptions going forward.",
    }),
  })
  .openapi("LinkSubscribers");

export const linkResultSchema = z
  .object({
    rows: z.array(
      z
        .object({
          subscriptionId: stripeSubscriptionId,
          email: z.string().nullable(),
          outcome: z.enum(["linked", "added", "invited", "skipped", "already_linked", "refused"]),
          reason: z
            .enum([...subscriberBlock.options, "not_found", "status", "match_changed"])
            .nullable(),
          platformFeeAdded: z.boolean(),
        })
        .openapi("LinkRowResult"),
    ),
    invitedEmails: z.array(z.string()),
  })
  .openapi("LinkResult");

export const subscriptionLinkListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.uuid(),
          externalSubscriptionId: stripeSubscriptionId,
          email: z.string(),
          status: z.enum(["linked", "invited"]),
          interval: planInterval,
          platformFeeBps: z.number().int(),
          linkedAt: isoDate.nullable(),
          createdAt: isoDate,
        })
        .openapi("SubscriptionLink"),
    ),
    ...pageCursor,
  })
  .openapi("SubscriptionLinkList");

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function discoveredSubscriberJson(
  row: DiscoveredSubscriber,
): z.infer<typeof discoveredSubscriberSchema> {
  return {
    ...row,
    currentPeriodEnd: iso(row.currentPeriodEnd),
    allowed: [...row.allowed],
  };
}

export function discoveryJson(
  discovery: SubscriberDiscovery,
): z.infer<typeof subscriberDiscoverySchema> {
  return {
    data: discovery.rows.map(discoveredSubscriberJson),
    nextCursor: discovery.nextCursor,
    plan: discovery.plan,
    edition: discovery.edition,
    platformFeeBps: discovery.platformFeeBps,
    canAddPlatformFee: discovery.canAddPlatformFee,
  };
}

export function linkResultJson(result: LinkResult): z.infer<typeof linkResultSchema> {
  return { rows: result.rows.map((row) => ({ ...row })), invitedEmails: [...result.invitedEmails] };
}

export function subscriptionLinkListJson(
  links: readonly SubscriptionLinkView[],
): z.infer<typeof subscriptionLinkListSchema> {
  return {
    data: links.map((link) => ({
      ...link,
      linkedAt: iso(link.linkedAt),
      createdAt: link.createdAt.toISOString(),
    })),
    nextCursor: null,
  };
}
