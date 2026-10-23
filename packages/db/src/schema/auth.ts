import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { citext, id, timestamps } from "./columns";

export const termsVersionMaxLength = 64;

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: citext("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    username: citext("username").unique(),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletionScheduledFor: timestamp("deletion_scheduled_for", { withTimezone: true }),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("users_name_prefix_idx").using("btree", sql`lower(${t.name}) text_pattern_ops`),
    index("users_deletion_due_idx")
      .on(t.deletionScheduledFor)
      .where(sql`${t.deletionScheduledFor} is not null and ${t.erasedAt} is null`),
    index("users_username_prefix_idx").using(
      "btree",
      sql`lower(${t.username}::text) text_pattern_ops`,
    ),
    index("users_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.name} || ' ' || coalesce(${t.username}::text, ''))`,
    ),
    check(
      "users_terms_accepted",
      sql`(${t.termsVersion} is null) = (${t.termsAcceptedAt} is null) and (${t.termsVersion} is null or char_length(${t.termsVersion}) between 1 and ${sql.raw(String(termsVersionMaxLength))})`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    unique("accounts_provider_account_unique").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
