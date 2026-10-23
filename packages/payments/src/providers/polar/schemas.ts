import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const metadataValue = z.union([z.string(), z.number(), z.boolean()]);

export const polarMetadataSchema = z
  .record(z.string(), metadataValue)
  .default({})
  .transform((metadata) =>
    Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)])),
  );

export const polarOrganizationSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  details_submitted_at: timestamp.nullish(),
  capabilities: z.looseObject({ checkout_payments: z.boolean().optional() }).nullish(),
});

export const polarOrganizationListSchema = z.looseObject({
  items: z.array(polarOrganizationSchema),
});

export const polarProductSchema = z.looseObject({
  id: z.string(),
  is_archived: z.boolean(),
  recurring_interval: z.string().nullable(),
  metadata: polarMetadataSchema,
});

export const polarProductListSchema = z.looseObject({ items: z.array(polarProductSchema) });

export const polarCheckoutSchema = z.looseObject({ id: z.string(), url: z.url() });

export const polarCustomerSessionSchema = z.looseObject({ customer_portal_url: z.url() });

export const polarSubscriptionSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  customer_id: z.string(),
  product_id: z.string().nullish(),
  current_period_end: timestamp.nullish(),
  cancel_at_period_end: z.boolean(),
  ends_at: timestamp.nullish(),
  ended_at: timestamp.nullish(),
  recurring_interval: z.string().nullish(),
  recurring_interval_count: z.number().int().nullish(),
  metadata: polarMetadataSchema,
});

export const polarOrderSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  paid: z.boolean(),
  net_amount: z.number().int().nonnegative(),
  tax_amount: z.number().int().nonnegative(),
  total_amount: z.number().int().nonnegative(),
  refunded_amount: z.number().int().nonnegative(),
  refunded_tax_amount: z.number().int().nonnegative(),
  refundable_amount: z.number().int().nonnegative().optional(),
  currency: z.string(),
  subscription_id: z.string().nullish(),
  created_at: timestamp,
});

export const polarRefundSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
});

export const polarCheckoutEventSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  subscription_id: z.string().nullish(),
  metadata: polarMetadataSchema,
});

export const polarEnvelopeSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().optional(),
  data: z.looseObject({ id: z.string().min(1) }),
});

export type PolarSubscription = z.output<typeof polarSubscriptionSchema>;
export type PolarOrder = z.output<typeof polarOrderSchema>;
