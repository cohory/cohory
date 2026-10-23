import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { tenant } from "./communities";

export const webhookEndpointStatus = pgEnum("webhook_endpoint_status", ["active", "disabled"]);
export const webhookDisabledReason = pgEnum("webhook_disabled_reason", ["manual", "failures"]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "succeeded",
  "failed",
]);

export type WebhookEndpointStatus = (typeof webhookEndpointStatus.enumValues)[number];
export type WebhookDisabledReason = (typeof webhookDisabledReason.enumValues)[number];
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatus.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.webhooks_manager', true), '') = 'on'`;
const isJob = sql`coalesce(current_setting('app.webhook_jobs', true), '') = 'on'`;

function access(communityId: AnyPgColumn): SQL {
  return sql`(${communityId} = ${currentCommunity} and ${isManager}) or ${isJob}`;
}

function webhookPolicy(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: access(communityId),
    withCheck: access(communityId),
  });
}

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    communityId: tenant(),
    url: text("url").notNull(),
    description: text("description"),
    eventTypes: text("event_types").array().notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    previousSecretCiphertext: text("previous_secret_ciphertext"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at", { withTimezone: true }),
    status: webhookEndpointStatus("status").notNull().default("active"),
    disabledReason: webhookDisabledReason("disabled_reason"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("webhook_endpoints_community_idx").on(t.communityId, t.createdAt),
    index("webhook_endpoints_created_by_idx")
      .on(t.createdBy)
      .where(sql`${t.createdBy} is not null`),
    check("webhook_endpoints_url_length", sql`char_length(${t.url}) between 8 and 2048`),
    check(
      "webhook_endpoints_description_length",
      sql`${t.description} is null or char_length(${t.description}) <= 200`,
    ),
    check("webhook_endpoints_event_types_present", sql`cardinality(${t.eventTypes}) >= 1`),
    check(
      "webhook_endpoints_disabled_state",
      sql`(${t.status} = 'active') = (${t.disabledAt} is null and ${t.disabledReason} is null)`,
    ),
    check("webhook_endpoints_failures_nonnegative", sql`${t.consecutiveFailures} >= 0`),
    check(
      "webhook_endpoints_previous_secret_expiry",
      sql`(${t.previousSecretCiphertext} is null) = (${t.previousSecretExpiresAt} is null)`,
    ),
    webhookPolicy("webhook_endpoints_access", t.communityId),
  ],
);

export interface WebhookPayload {
  readonly type: string;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    communityId: tenant(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<WebhookPayload>().notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("webhook_deliveries_endpoint_event_unique").on(t.endpointId, t.eventId),
    index("webhook_deliveries_endpoint_idx").on(
      t.communityId,
      t.endpointId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("webhook_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index("webhook_deliveries_in_flight_idx")
      .on(t.endpointId, t.lockedUntil)
      .where(sql`${t.status} = 'pending' and ${t.lockedUntil} is not null`),
    check("webhook_deliveries_attempts_nonnegative", sql`${t.attempts} >= 0`),
    check(
      "webhook_deliveries_pending_scheduled",
      sql`${t.status} <> 'pending' or ${t.nextAttemptAt} is not null`,
    ),
    check("webhook_deliveries_error_length", sql`char_length(${t.lastError}) <= 200`),
    webhookPolicy("webhook_deliveries_access", t.communityId),
  ],
);

export const webhookResponseExcerptMaxLength = 2048;

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: id(),
    communityId: tenant(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    requestHeaders: jsonb("request_headers").$type<Readonly<Record<string, string>>>().notNull(),
    requestBody: text("request_body").notNull(),
    responseStatus: integer("response_status"),
    responseBodyExcerpt: text("response_body_excerpt"),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("webhook_delivery_attempts_delivery_idx").on(
      t.communityId,
      t.deliveryId,
      t.attemptedAt.desc().nullsFirst(),
    ),
    index("webhook_delivery_attempts_delivery_id_idx").on(t.deliveryId),
    check(
      "webhook_delivery_attempts_excerpt_length",
      sql`char_length(${t.responseBodyExcerpt}) <= ${sql.raw(String(webhookResponseExcerptMaxLength))}`,
    ),
    check("webhook_delivery_attempts_error_length", sql`char_length(${t.errorCode}) <= 200`),
    check(
      "webhook_delivery_attempts_duration_nonnegative",
      sql`${t.durationMs} is null or ${t.durationMs} >= 0`,
    ),
    webhookPolicy("webhook_delivery_attempts_access", t.communityId),
  ],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type WebhookDeliveryAttempt = typeof webhookDeliveryAttempts.$inferSelect;
