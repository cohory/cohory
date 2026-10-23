import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { accountPurgeOwnRows } from "./identity";
import { tenant } from "./communities";
import { comments, posts } from "./posts";

export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "other",
]);

export const reportStatus = pgEnum("report_status", [
  "open",
  "dismissed",
  "content_removed",
  "member_banned",
]);

export type ReportReason = (typeof reportReason.enumValues)[number];
export type ReportStatus = (typeof reportStatus.enumValues)[number];

export const reportNoteMaxLength = 500;

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.community_manager', true), '') = 'on'`;

export const contentReports = pgTable(
  "content_reports",
  {
    id: id(),
    communityId: tenant(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: reportReason("reason").notNull(),
    note: text("note"),
    status: reportStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("content_reports_queue_idx").on(t.communityId, t.status, t.createdAt.desc()),
    uniqueIndex("content_reports_one_open_post")
      .on(t.communityId, t.postId, t.reporterId)
      .where(sql`${t.commentId} is null and ${t.status} = 'open'`),
    uniqueIndex("content_reports_one_open_comment")
      .on(t.communityId, t.commentId, t.reporterId)
      .where(sql`${t.commentId} is not null and ${t.status} = 'open'`),
    index("content_reports_post_idx").on(t.postId),
    index("content_reports_comment_idx")
      .on(t.commentId)
      .where(sql`${t.commentId} is not null`),
    index("content_reports_reporter_idx").on(t.reporterId),
    index("content_reports_resolved_by_idx")
      .on(t.resolvedBy)
      .where(sql`${t.resolvedBy} is not null`),
    check(
      "content_reports_note_length",
      sql`char_length(${t.note}) <= ${sql.raw(String(reportNoteMaxLength))}`,
    ),
    check("content_reports_resolution", sql`(${t.status} = 'open') = (${t.resolvedAt} is null)`),
    pgPolicy("content_reports_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
    }),
    pgPolicy("content_reports_own_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${t.reporterId} = ${currentUser}`,
    }),
    pgPolicy("content_reports_own_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${t.reporterId} = ${currentUser} and ${t.status} = 'open'`,
    }),
    pgPolicy("content_reports_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.reporterId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.reporterId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export type ContentReport = typeof contentReports.$inferSelect;
