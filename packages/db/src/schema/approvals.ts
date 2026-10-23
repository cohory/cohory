import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { agentIdentities, apiTokens } from "./agents";
import { users } from "./auth";
import { id, timestamps } from "./columns";
import { tenant } from "./communities";

export const approvalState = pgEnum("approval_state", [
  "pending",
  "approved",
  "executed",
  "failed",
  "rejected",
  "expired",
]);

export type ApprovalState = (typeof approvalState.enumValues)[number];

export interface ApprovalRecordedInput {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ApprovalDiffLine {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isJob = sql`coalesce(current_setting('app.approval_jobs', true), '') = 'on'`;

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    communityId: tenant(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentIdentities.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    operationId: text("operation_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    category: text("category").notNull(),
    input: jsonb("input").$type<ApprovalRecordedInput>().notNull(),
    summary: text("summary").notNull(),
    diff: jsonb("diff").$type<readonly ApprovalDiffLine[]>().notNull(),
    state: approvalState("state").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("approval_requests_community_state_v2_idx").on(
      t.communityId,
      t.state,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("approval_requests_community_agent_idx").on(t.communityId, t.agentId, t.state),
    index("approval_requests_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.state} = 'pending'`),
    index("approval_requests_agent_id_idx").on(t.agentId),
    index("approval_requests_owner_id_idx").on(t.ownerId),
    index("approval_requests_token_id_idx")
      .on(t.tokenId)
      .where(sql`${t.tokenId} is not null`),
    index("approval_requests_decided_by_idx")
      .on(t.decidedBy)
      .where(sql`${t.decidedBy} is not null`),
    check("approval_requests_summary_length", sql`char_length(${t.summary}) between 1 and 300`),
    check(
      "approval_requests_note_length",
      sql`${t.decisionNote} is null or char_length(${t.decisionNote}) <= 500`,
    ),
    check(
      "approval_requests_decided",
      sql`(${t.state} in ('pending', 'expired')) = (${t.decidedAt} is null)`,
    ),
    pgPolicy("approval_requests_access", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} or ${isJob}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} or ${isJob}`,
    }),
  ],
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
