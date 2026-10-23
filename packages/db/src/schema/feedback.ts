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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { detachedTenant } from "./communities";

export const creatorMoments = ["first_post", "first_paid_member", "first_course"] as const;
export const creatorExitActions = [
  "archive_community",
  "delete_community",
  "disconnect_stripe",
  "delete_account",
] as const;
export const creatorExitReasons = [
  "too_expensive",
  "missing_feature",
  "too_hard",
  "moving_platform",
  "not_enough_activity",
  "only_testing",
  "other",
] as const;

export const creatorFeedbackRetentionMonths = 24;

export const creatorFeedbackCommentMaxLength = 1000;

export const creatorFeedbackKind = pgEnum("creator_feedback_kind", ["moment", "exit"]);
export const creatorFeedbackTopic = pgEnum("creator_feedback_topic", [
  ...creatorMoments,
  ...creatorExitActions,
]);
export const creatorFeedbackStatus = pgEnum("creator_feedback_status", [
  "pending",
  "answered",
  "dismissed",
  "snoozed",
]);
export const creatorExitReason = pgEnum("creator_exit_reason", creatorExitReasons);

export type CreatorMoment = (typeof creatorMoments)[number];
export type CreatorExitAction = (typeof creatorExitActions)[number];
export type CreatorExitReason = (typeof creatorExitReasons)[number];
export type CreatorFeedbackStatus = (typeof creatorFeedbackStatus.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

const momentList = sql.raw(creatorMoments.map((moment) => `'${moment}'`).join(", "));

export const creatorFeedback = pgTable(
  "creator_feedback",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    communityId: detachedTenant(),
    kind: creatorFeedbackKind("kind").notNull(),
    topic: creatorFeedbackTopic("topic").notNull(),
    status: creatorFeedbackStatus("status").notNull(),
    score: smallint("score"),
    reason: creatorExitReason("reason"),
    comment: text("comment"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("creator_feedback_community_moment_unique")
      .on(t.communityId, t.topic)
      .where(sql`${t.kind} = 'moment'`),
    index("creator_feedback_community_idx").on(t.communityId),
    index("creator_feedback_user_responded_idx").on(t.userId, t.respondedAt),
    check("creator_feedback_score_range", sql`${t.score} between 1 and 5`),
    check(
      "creator_feedback_comment_length",
      sql`char_length(${t.comment}) between 1 and ${sql.raw(String(creatorFeedbackCommentMaxLength))}`,
    ),
    check(
      "creator_feedback_kind_shape",
      sql`(${t.kind} = 'moment' and ${t.topic} in (${momentList}) and ${t.reason} is null)
        or (${t.kind} = 'exit' and ${t.topic} not in (${momentList}) and ${t.score} is null and ${t.status} = 'answered')`,
    ),
    check(
      "creator_feedback_answer_shape",
      sql`(${t.status} = 'pending') = (${t.respondedAt} is null)
        and (${t.status} = 'answered' or (${t.score} is null and ${t.comment} is null))`,
    ),
    pgPolicy("creator_feedback_own_rows", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser} and (${t.communityId} is null or ${t.communityId} = ${currentCommunity})`,
    }),
    pgPolicy("creator_feedback_retention_sweep", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`coalesce(current_setting('app.feedback_retention', true), '') = 'on' and ${t.createdAt} < now() - interval '${sql.raw(String(creatorFeedbackRetentionMonths))} months'`,
      withCheck: sql`false`,
    }),
  ],
);

export type CreatorFeedbackRow = typeof creatorFeedback.$inferSelect;
