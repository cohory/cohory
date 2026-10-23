import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id } from "./columns";
import { isCommunityPurge, tenant } from "./communities";

export const pointsReason = pgEnum("points_reason", [
  "like_received",
  "like_removed",
  "post_deleted",
  "comment_deleted",
  "admin_reset",
  "lesson_completed",
  "event_attended",
]);

export type PointsReason = (typeof pointsReason.enumValues)[number];

export const pointsSourceTypes = [
  "reaction",
  "points_reset",
  "points_reset_member",
  "lesson",
  "event_occurrence",
] as const;

export const learningSourceTypes = ["lesson", "event_occurrence"] as const;

const learningSources = sql.raw(learningSourceTypes.map((v) => `'${v}'`).join(", "));

export type PointsSourceType = (typeof pointsSourceTypes)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;

export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    delta: integer("delta").notNull(),
    reason: pointsReason("reason").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("points_ledger_community_occurred_idx").on(t.communityId, t.occurredAt),
    index("points_ledger_community_user_idx").on(t.communityId, t.userId),
    index("points_ledger_user_id_idx").on(t.userId),
    uniqueIndex("points_ledger_source_reason_v2_unique")
      .on(t.sourceType, t.sourceId, t.reason)
      .where(sql`${t.sourceType} not in (${learningSources})`),
    uniqueIndex("points_ledger_learning_unique")
      .on(t.communityId, t.userId, t.sourceType, t.sourceId, t.reason)
      .where(sql`${t.sourceType} in (${learningSources})`),
    uniqueIndex("points_ledger_one_reversal_per_source")
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.reason} in ('like_removed', 'post_deleted', 'comment_deleted')`),
    index("points_ledger_admin_reset_idx")
      .on(t.communityId, t.userId, t.occurredAt.desc())
      .where(sql`${t.reason} = 'admin_reset'`),
    check("points_ledger_delta_nonzero", sql`${t.delta} <> 0`),
    check(
      "points_ledger_source_type_known",
      sql`${t.sourceType} is null or ${t.sourceType} in (${sql.raw(pointsSourceTypes.map((v) => `'${v}'`).join(", "))})`,
    ),
    pgPolicy("points_ledger_tenant_select", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("points_ledger_tenant_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("points_ledger_community_purge", {
      as: "permissive",
      for: "delete",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isCommunityPurge}`,
    }),
  ],
);

export const pointsLedgerSourceCleanup0035 = pgTable("points_ledger_source_cleanup_0035", {
  ledgerId: uuid("ledger_id").primaryKey(),
  communityId: uuid("community_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  cleanedAt: timestamp("cleaned_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const memberStats = pgTable(
  "member_stats",
  {
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    pointsTotal: integer("points_total").notNull().default(0),
    level: smallint("level").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "member_stats_pkey", columns: [t.communityId, t.userId] }),
    index("member_stats_leaderboard_v2_idx").on(
      t.communityId,
      t.pointsTotal.desc().nullsFirst(),
      t.updatedAt,
      t.userId,
    ),
    index("member_stats_community_level_idx").on(t.communityId, t.level),
    index("member_stats_user_id_idx").on(t.userId),
    check("member_stats_level_range", sql`${t.level} between 1 and 9`),
    pgPolicy("member_stats_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);
