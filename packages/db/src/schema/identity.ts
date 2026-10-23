import { sql } from "drizzle-orm";
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id } from "./columns";

const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

export const accountPurgeOwnRows = sql`coalesce(current_setting('app.account_purge', true), '') = 'on'`;

export const accountAuditLog = pgTable(
  "account_audit_log",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_audit_log_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("account_audit_log_own_rows", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);

export type AccountAuditEntry = typeof accountAuditLog.$inferSelect;
