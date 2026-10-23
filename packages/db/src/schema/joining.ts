import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { accountPurgeOwnRows } from "./identity";
import { tenant } from "./communities";

export const membershipRequestStatus = pgEnum("membership_request_status", [
  "pending",
  "approved",
  "declined",
]);

export type MembershipRequestStatus = (typeof membershipRequestStatus.enumValues)[number];

export interface JoinAnswerJson {
  readonly question: string;
  readonly answer: string;
}

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.community_manager', true), '') = 'on'`;

export const membershipRequests = pgTable(
  "membership_requests",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: membershipRequestStatus("status").notNull().default("pending"),
    answers: jsonb("answers")
      .$type<JoinAnswerJson[]>()
      .notNull()
      .$defaultFn(() => []),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("membership_requests_one_pending")
      .on(t.communityId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    index("membership_requests_queue_v2_idx").on(
      t.communityId,
      t.status,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("membership_requests_user_idx").on(t.userId),
    index("membership_requests_decided_by_idx")
      .on(t.decidedBy)
      .where(sql`${t.decidedBy} is not null`),
    check("membership_requests_note_length", sql`char_length(${t.decisionNote}) <= 500`),
    check("membership_requests_answers_limit", sql`jsonb_array_length(${t.answers}) <= 3`),
    pgPolicy("membership_requests_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
    }),
    pgPolicy("membership_requests_own_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("membership_requests_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
    pgPolicy("membership_requests_own_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser} and ${t.status} = 'pending'`,
    }),
  ],
);

export type MembershipRequest = typeof membershipRequests.$inferSelect;

const isPaymentsWebhook = sql`coalesce(current_setting('app.payments_webhook', true), '') = 'on'`;

export const pendingJoinAnswers = pgTable(
  "pending_join_answers",
  {
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    answers: jsonb("answers")
      .$type<JoinAnswerJson[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pending_join_answers_pkey", columns: [t.communityId, t.userId] }),
    index("pending_join_answers_user_idx").on(t.userId),
    check(
      "pending_join_answers_answers_limit",
      sql`jsonb_typeof(${t.answers}) = 'array' and jsonb_array_length(${t.answers}) <= 3`,
    ),
    pgPolicy("pending_join_answers_own_rows", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("pending_join_answers_activation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isPaymentsWebhook}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isPaymentsWebhook}`,
    }),
    pgPolicy("pending_join_answers_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export type PendingJoinAnswers = typeof pendingJoinAnswers.$inferSelect;
