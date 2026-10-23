import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { tenant } from "./communities";

export const migrationJobKind = pgEnum("migration_job_kind", ["export", "import", "members_csv"]);

export const migrationJobStatus = pgEnum("migration_job_status", [
  "ready",
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const migrationEmailChoice = pgEnum("migration_email_choice", ["now", "later", "never"]);

export type MigrationJobKind = (typeof migrationJobKind.enumValues)[number];
export type MigrationJobStatus = (typeof migrationJobStatus.enumValues)[number];
export type MigrationEmailChoice = (typeof migrationEmailChoice.enumValues)[number];

export interface MigrationProgressJson {
  readonly phase: string;
  readonly done: number;
  readonly total: number;
}

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.migration_manager', true), '') = 'on'`;

export const migrationJobs = pgTable(
  "migration_jobs",
  {
    id: id(),
    communityId: tenant(),
    kind: migrationJobKind("kind").notNull(),
    status: migrationJobStatus("status").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileBytes: bigint("file_bytes", { mode: "number" }),
    options: jsonb("options").$type<Record<string, unknown>>(),
    preview: jsonb("preview").$type<Record<string, unknown>>(),
    progress: jsonb("progress").$type<MigrationProgressJson>(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    emailChoice: migrationEmailChoice("email_choice"),
    emailsSentAt: timestamp("emails_sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("migration_jobs_community_created_v2_idx").on(
      t.communityId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("migration_jobs_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.deletedAt} is null and ${t.expiresAt} is not null`),
    index("migration_jobs_requested_by_idx")
      .on(t.requestedBy)
      .where(sql`${t.requestedBy} is not null`),
    pgPolicy("migration_jobs_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
    }),
  ],
);

export const migrationIdMap = pgTable(
  "migration_id_map",
  {
    communityId: tenant(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => migrationJobs.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (t) => [
    primaryKey({
      name: "migration_id_map_pkey",
      columns: [t.communityId, t.jobId, t.entity, t.sourceId],
    }),
    index("migration_id_map_job_idx").on(t.jobId),
    pgPolicy("migration_id_map_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isManager}`,
    }),
  ],
);

export type MigrationJob = typeof migrationJobs.$inferSelect;
