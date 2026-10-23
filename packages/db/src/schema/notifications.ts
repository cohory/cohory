import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id } from "./columns";
import { isCommunityPurge, tenant } from "./communities";
import { posts } from "./posts";

export const notificationType = pgEnum("notification_type", [
  "mention",
  "reply",
  "comment_on_post",
  "like_on_post",
  "like_on_comment",
  "join_request",
  "join_request_approved",
  "join_request_declined",
  "approval_request",
  "agent_access",
  "report_actioned",
  "report_dismissed",
  "review_created",
  "paid_membership_changed",
  "ownership_transferred",
  "payment_disputed",
  "member_joined",
  "report_created",
  "event_created",
  "event_reminder",
  "paid_member_joined",
  "paid_member_canceled",
  "member_payment_failed",
  "token_expiring",
  "comment_on_followed_post",
]);
export const notificationSubjectType = pgEnum("notification_subject_type", [
  "post",
  "comment",
  "membership_request",
  "approval_request",
  "course_delegation",
  "review",
  "community",
  "report",
  "event",
  "api_token",
  "agent_token",
]);

export const notificationEmailMode = pgEnum("notification_email_mode", [
  "immediate",
  "daily",
  "off",
]);
export const notificationChannel = pgEnum("notification_channel", ["email"]);
export const notificationDeliveryOutcome = pgEnum("notification_delivery_outcome", [
  "sent",
  "skipped",
]);

export type NotificationType = (typeof notificationType.enumValues)[number];
export type NotificationEmailMode = (typeof notificationEmailMode.enumValues)[number];
export type NotificationDeliveryOutcome = (typeof notificationDeliveryOutcome.enumValues)[number];
export type NotificationSubjectType = (typeof notificationSubjectType.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isNotificationJob = sql`coalesce(current_setting('app.notification_jobs', true), '') = 'on'`;

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    type: notificationType("type").notNull(),
    subjectType: notificationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    detail: text("detail"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_unread_idx").on(t.userId, t.readAt, t.createdAt.desc()),
    index("notifications_user_created_idx").on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("notifications_community_idx").on(t.communityId, t.postId),
    index("notifications_post_id_idx")
      .on(t.postId)
      .where(sql`${t.postId} is not null`),
    index("notifications_actor_id_idx").on(t.actorId),
    index("notifications_created_idx").on(t.createdAt),
    check(
      "notifications_post_subject",
      sql`${t.postId} is not null or ${t.subjectType}::text in ('membership_request', 'approval_request', 'course_delegation', 'review', 'community', 'report', 'event', 'api_token', 'agent_token')`,
    ),
    check(
      "notifications_detail_length",
      sql`${t.detail} is null or char_length(${t.detail}) <= 300`,
    ),
    uniqueIndex("notifications_unread_dedupe")
      .on(t.userId, t.type, t.subjectId, t.actorId)
      .where(sql`${t.readAt} is null`),
    pgPolicy("notifications_tenant_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("notifications_own_rows_select", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
    }),
    pgPolicy("notifications_own_rows_update", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
    pgPolicy("notifications_own_rows_delete", {
      as: "permissive",
      for: "delete",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
    }),
    pgPolicy("notifications_community_purge_scan", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isCommunityPurge}`,
    }),
    pgPolicy("notifications_community_purge", {
      as: "permissive",
      for: "delete",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isCommunityPurge}`,
    }),
    pgPolicy("notifications_job_scan", {
      as: "permissive",
      for: "select",
      to: "public",
      using: isNotificationJob,
    }),
  ],
);

function ownRows(name: string, userId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${userId} = ${currentUser}`,
    withCheck: sql`${userId} = ${currentUser}`,
  });
}

function jobScan(name: string) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: isNotificationJob,
  });
}

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: notificationEmailMode("email").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.type] }),
    ownRows("notification_preferences_own_rows", t.userId),
    jobScan("notification_preferences_job_scan"),
  ],
);

export const notificationSettings = pgTable(
  "notification_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    digestHour: smallint("digest_hour").notNull().default(8),
    timeZone: text("time_zone").notNull().default("UTC"),
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    weeklyDigest: boolean("weekly_digest").notNull().default(true),
    lastWeeklyDigestAt: timestamp("last_weekly_digest_at", { withTimezone: true }),
    creatorFeedbackOptedOutAt: timestamp("creator_feedback_opted_out_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("notification_settings_digest_hour_range", sql`${t.digestHour} between 0 and 23`),
    check(
      "notification_settings_time_zone_length",
      sql`char_length(${t.timeZone}) between 1 and 64`,
    ),
    ownRows("notification_settings_own_rows", t.userId),
    jobScan("notification_settings_job_scan"),
  ],
);

export const notificationGroupSources = pgTable(
  "notification_group_sources",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    communityId: tenant(),
  },
  (t) => [
    primaryKey({ columns: [t.notificationId, t.sourceKey] }),
    index("notification_group_sources_community_idx").on(t.communityId, t.notificationId),
    check(
      "notification_group_sources_source_key_length",
      sql`char_length(${t.sourceKey}) between 1 and 64`,
    ),
    pgPolicy("notification_group_sources_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: id(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull(),
    outcome: notificationDeliveryOutcome("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_deliveries_once").on(t.notificationId, t.channel),
    index("notification_deliveries_user_idx").on(t.userId, t.createdAt),
    ownRows("notification_deliveries_own_rows", t.userId),
    jobScan("notification_deliveries_job_scan"),
  ],
);
