import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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

import { id } from "./columns";
import { communities } from "./communities";

const isEmailDelivery = sql`coalesce(current_setting('app.email_delivery', true), '') = 'on'`;

export const emailLogStatus = pgEnum("email_log_status", ["sent", "failed", "suppressed"]);
export const emailSuppressionReason = pgEnum("email_suppression_reason", [
  "hard_bounce",
  "complaint",
  "manual",
  "opt_out",
]);
export const emailSuppressionSource = pgEnum("email_suppression_source", [
  "smtp",
  "webhook",
  "operator",
  "member",
]);

export type EmailLogStatus = (typeof emailLogStatus.enumValues)[number];
export type EmailSuppressionReason = (typeof emailSuppressionReason.enumValues)[number];
export type EmailSuppressionSource = (typeof emailSuppressionSource.enumValues)[number];

function addressHashFormat(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[0-9a-f]{64}$'`);
}

function emailDelivery(name: string) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: isEmailDelivery,
    withCheck: isEmailDelivery,
  });
}

export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    template: text("template").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    status: emailLogStatus("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_log_created_idx").on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("email_log_recipient_created_idx").on(t.recipientHash, t.createdAt.desc().nullsFirst()),
    addressHashFormat("email_log_recipient_hash_format", t.recipientHash),
    check("email_log_template_length", sql`char_length(${t.template}) between 1 and 64`),
    check(
      "email_log_error_code_length",
      sql`${t.errorCode} is null or char_length(${t.errorCode}) <= 64`,
    ),
    emailDelivery("email_log_delivery"),
  ],
);

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: id(),
    addressHash: text("address_hash").notNull(),
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    reason: emailSuppressionReason("reason").notNull(),
    source: emailSuppressionSource("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_suppressions_instance_unique")
      .on(t.addressHash)
      .where(sql`${t.communityId} is null`),
    uniqueIndex("email_suppressions_community_unique")
      .on(t.communityId, t.addressHash)
      .where(sql`${t.communityId} is not null`),
    index("email_suppressions_address_idx").on(t.addressHash),
    addressHashFormat("email_suppressions_address_hash_format", t.addressHash),
    emailDelivery("email_suppressions_delivery"),
  ],
);

export type EmailLogEntry = typeof emailLog.$inferSelect;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
