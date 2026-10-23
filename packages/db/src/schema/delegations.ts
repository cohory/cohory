import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { agentIdentities } from "./agents";
import { users } from "./auth";
import { id, timestamps } from "./columns";
import { tenant } from "./communities";
import { courses } from "./courses";

export const delegationEndReason = pgEnum("delegation_end_reason", [
  "revoked",
  "expired",
  "access_ended",
  "agent_inactive",
  "agent_access_off",
]);

export type DelegationEndReason = (typeof delegationEndReason.enumValues)[number];

export const agentLicenseIds = ["personal_agents", "team_agents", "custom"] as const;

export type AgentLicenseId = (typeof agentLicenseIds)[number];

export const maxSubmissionPayloadBytes = 64 * 1024;

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isJob = sql`coalesce(current_setting('app.delegation_jobs', true), '') = 'on'`;

export const courseAgentSettings = pgTable(
  "course_agent_settings",
  {
    courseId: uuid("course_id").primaryKey(),
    communityId: tenant(),
    allowAgentAccess: boolean("allow_agent_access").notNull().default(false),
    licenseId: text("license_id").notNull().default("personal_agents"),
    licenseText: text("license_text"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "course_agent_settings_course_fk",
      columns: [t.communityId, t.courseId],
      foreignColumns: [courses.communityId, courses.id],
    }).onDelete("cascade"),
    index("course_agent_settings_community_idx").on(t.communityId, t.allowAgentAccess),
    index("course_agent_settings_updated_by_idx")
      .on(t.updatedBy)
      .where(sql`${t.updatedBy} is not null`),
    check(
      "course_agent_settings_license_id",
      sql`${t.licenseId} in ('personal_agents', 'team_agents', 'custom')`,
    ),
    check(
      "course_agent_settings_license_text",
      sql`${t.licenseText} is null or char_length(${t.licenseText}) between 1 and 2000`,
    ),
    check(
      "course_agent_settings_custom_text",
      sql`${t.licenseId} <> 'custom' or ${t.licenseText} is not null`,
    ),
    pgPolicy("course_agent_settings_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} or ${isJob}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);

export const courseDelegations = pgTable(
  "course_delegations",
  {
    id: id(),
    communityId: tenant(),
    courseId: uuid("course_id").notNull(),
    humanId: uuid("human_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentIdentities.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    renewedAt: timestamp("renewed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: delegationEndReason("revoked_reason"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    expiryNoticeAt: timestamp("expiry_notice_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "course_delegations_course_fk",
      columns: [t.communityId, t.courseId],
      foreignColumns: [courses.communityId, courses.id],
    }).onDelete("cascade"),
    uniqueIndex("course_delegations_live_unique")
      .on(t.communityId, t.courseId, t.agentId)
      .where(sql`${t.revokedAt} is null`),
    index("course_delegations_community_human_idx").on(t.communityId, t.humanId, t.grantedAt),
    index("course_delegations_community_agent_idx").on(t.communityId, t.agentId),
    index("course_delegations_community_course_idx").on(t.communityId, t.courseId),
    index("course_delegations_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.revokedAt} is null`),
    index("course_delegations_human_id_idx").on(t.humanId),
    index("course_delegations_agent_id_idx").on(t.agentId),
    index("course_delegations_revoked_by_idx")
      .on(t.revokedBy)
      .where(sql`${t.revokedBy} is not null`),
    check(
      "course_delegations_revoked",
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ),
    check("course_delegations_window", sql`${t.expiresAt} > ${t.grantedAt}`),
    pgPolicy("course_delegations_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} or ${isJob}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} or ${isJob}`,
    }),
  ],
);

export const agentSubmissions = pgTable(
  "agent_submissions",
  {
    id: id(),
    communityId: tenant(),
    courseId: uuid("course_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    taskId: text("task_id").notNull(),
    version: text("version").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentIdentities.id, { onDelete: "cascade" }),
    humanId: uuid("human_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delegationId: uuid("delegation_id").references(() => courseDelegations.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    label: text("label").notNull().default("self_reported"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "agent_submissions_course_fk",
      columns: [t.communityId, t.courseId],
      foreignColumns: [courses.communityId, courses.id],
    }).onDelete("cascade"),
    uniqueIndex("agent_submissions_run_unique").on(t.communityId, t.agentId, t.runId, t.taskId),
    index("agent_submissions_community_course_idx").on(
      t.communityId,
      t.courseId,
      t.lessonId,
      t.taskId,
    ),
    index("agent_submissions_community_human_idx").on(t.communityId, t.humanId, t.createdAt),
    index("agent_submissions_agent_id_idx").on(t.agentId),
    index("agent_submissions_human_id_idx").on(t.humanId),
    index("agent_submissions_delegation_id_idx")
      .on(t.delegationId)
      .where(sql`${t.delegationId} is not null`),
    check("agent_submissions_label", sql`${t.label} = 'self_reported'`),
    check("agent_submissions_lesson_id", sql`char_length(${t.lessonId}) between 1 and 200`),
    check("agent_submissions_task_id", sql`char_length(${t.taskId}) between 1 and 200`),
    check("agent_submissions_version", sql`char_length(${t.version}) between 1 and 64`),
    check("agent_submissions_run_id", sql`char_length(${t.runId}) between 1 and 200`),
    check(
      "agent_submissions_payload_size",
      sql`octet_length(${t.payload}::text) <= ${sql.raw(String(maxSubmissionPayloadBytes))}`,
    ),
    pgPolicy("agent_submissions_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);

export type CourseAgentSettingsRow = typeof courseAgentSettings.$inferSelect;
export type CourseDelegation = typeof courseDelegations.$inferSelect;
export type AgentSubmission = typeof agentSubmissions.$inferSelect;
