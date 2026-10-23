import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { citext, id, timestamps } from "./columns";
import { tenant } from "./communities";
import { migrationJobs } from "./migration";
import { subscriptions } from "./payments";

export const subscriberMoveSource = pgEnum("subscriber_move_source", [
  "skool",
  "circle",
  "archive",
  "csv",
  "manual",
]);

export const subscriberMoveStatus = pgEnum("subscriber_move_status", [
  "pending",
  "resubscribed",
  "expired",
]);

export type SubscriberMoveSource = (typeof subscriberMoveSource.enumValues)[number];
export type SubscriberMoveStatus = (typeof subscriberMoveStatus.enumValues)[number];

const inCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.payments_manager', true), '') = 'on'`;
const isPaymentsJob = sql`coalesce(current_setting('app.payments_webhook', true), '') = 'on'`;

export const subscriberMoves = pgTable(
  "subscriber_moves",
  {
    id: id(),
    communityId: tenant(),
    email: citext("email").notNull(),
    wasPaying: boolean("was_paying").notNull().default(false),
    source: subscriberMoveSource("source").notNull(),
    freeUntil: timestamp("free_until", { withTimezone: true }),
    status: subscriberMoveStatus("status").notNull().default("pending"),
    jobId: uuid("job_id").references(() => migrationJobs.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    resubscribedAt: timestamp("resubscribed_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("subscriber_moves_community_email_unique").on(t.communityId, t.email),
    index("subscriber_moves_community_status_idx").on(t.communityId, t.status, t.createdAt),
    index("subscriber_moves_expiry_idx")
      .on(t.freeUntil)
      .where(sql`${t.status} = 'pending' and ${t.freeUntil} is not null`),
    index("subscriber_moves_job_idx")
      .on(t.jobId)
      .where(sql`${t.jobId} is not null`),
    index("subscriber_moves_subscription_idx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    index("subscriber_moves_created_by_idx")
      .on(t.createdBy)
      .where(sql`${t.createdBy} is not null`),
    check(
      "subscriber_moves_resubscribed",
      sql`(${t.status} = 'resubscribed') = (${t.resubscribedAt} is not null)`,
    ),
    pgPolicy("subscriber_moves_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${inCommunity} and ${isManager}`,
      withCheck: sql`${t.communityId} = ${inCommunity} and ${isManager}`,
    }),
    pgPolicy("subscriber_moves_payments_job", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${inCommunity} and ${isPaymentsJob}`,
      withCheck: sql`${t.communityId} = ${inCommunity} and ${isPaymentsJob}`,
    }),
  ],
);

export type SubscriberMove = typeof subscriberMoves.$inferSelect;
