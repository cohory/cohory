import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { memberships, tenant } from "./communities";
import { accountPurgeOwnRows } from "./identity";
import { reportReason } from "./moderation";

export const reviewHiddenReason = pgEnum("review_hidden_reason", [
  "spam",
  "abuse",
  "personal_data",
  "off_topic",
]);

export const reviewReportStatus = pgEnum("review_report_status", ["open", "dismissed", "hidden"]);

export type ReviewHiddenReason = (typeof reviewHiddenReason.enumValues)[number];
export type ReviewReportStatus = (typeof reviewReportStatus.enumValues)[number];

export const reviewBodyMinLength = 20;
export const reviewBodyMaxLength = 2000;
export const reviewReplyMaxLength = 2000;
export const reviewReportNoteMaxLength = 500;

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    communityId: tenant(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    membershipId: uuid("membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    rating: smallint("rating").notNull(),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenReason: reviewHiddenReason("hidden_reason"),
    hiddenBy: uuid("hidden_by").references(() => users.id, { onDelete: "set null" }),
    authorRemovedAt: timestamp("author_removed_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("reviews_community_created_v2_idx").on(
      t.communityId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("reviews_community_rating_idx").on(t.communityId, t.rating),
    unique("reviews_one_per_member").on(t.communityId, t.authorId),
    index("reviews_author_idx")
      .on(t.authorId)
      .where(sql`${t.authorId} is not null`),
    index("reviews_membership_idx")
      .on(t.membershipId)
      .where(sql`${t.membershipId} is not null`),
    index("reviews_hidden_by_idx")
      .on(t.hiddenBy)
      .where(sql`${t.hiddenBy} is not null`),
    check("reviews_rating_range", sql`${t.rating} between 1 and 5`),
    check(
      "reviews_body_length",
      sql`char_length(${t.body}) between ${sql.raw(String(reviewBodyMinLength))} and ${sql.raw(String(reviewBodyMaxLength))}`,
    ),
    check("reviews_hidden_consistent", sql`(${t.hiddenAt} is null) = (${t.hiddenReason} is null)`),
    check(
      "reviews_author_or_anonymized",
      sql`${t.authorId} is not null or ${t.anonymizedAt} is not null`,
    ),
    pgPolicy("reviews_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("reviews_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.authorId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.authorId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export const reviewReplies = pgTable(
  "review_replies",
  {
    id: id(),
    communityId: tenant(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("review_replies_community_idx").on(t.communityId, t.reviewId),
    uniqueIndex("review_replies_one_per_review").on(t.reviewId),
    index("review_replies_author_idx")
      .on(t.authorId)
      .where(sql`${t.authorId} is not null`),
    check(
      "review_replies_body_length",
      sql`char_length(${t.body}) between 1 and ${sql.raw(String(reviewReplyMaxLength))}`,
    ),
    pgPolicy("review_replies_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);

export const reviewReports = pgTable(
  "review_reports",
  {
    id: id(),
    communityId: tenant(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: reportReason("reason").notNull(),
    note: text("note"),
    status: reviewReportStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("review_reports_queue_idx").on(t.communityId, t.status, t.createdAt.desc()),
    uniqueIndex("review_reports_one_open")
      .on(t.communityId, t.reviewId, t.reporterId)
      .where(sql`${t.status} = 'open'`),
    index("review_reports_review_idx").on(t.reviewId),
    index("review_reports_reporter_idx").on(t.reporterId),
    index("review_reports_resolved_by_idx")
      .on(t.resolvedBy)
      .where(sql`${t.resolvedBy} is not null`),
    check(
      "review_reports_note_length",
      sql`char_length(${t.note}) <= ${sql.raw(String(reviewReportNoteMaxLength))}`,
    ),
    check("review_reports_resolution", sql`(${t.status} = 'open') = (${t.resolvedAt} is null)`),
    pgPolicy("review_reports_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("review_reports_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.reporterId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.reporterId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export type Review = typeof reviews.$inferSelect;
export type ReviewReply = typeof reviewReplies.$inferSelect;
export type ReviewReport = typeof reviewReports.$inferSelect;
