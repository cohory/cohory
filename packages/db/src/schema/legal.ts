import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { termsVersionMaxLength, users } from "./auth";
import { tenant } from "./communities";

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isPaymentsManager = sql`coalesce(current_setting('app.payments_manager', true), '') = 'on'`;

export const creatorTermsAcceptances = pgTable(
  "creator_terms_acceptances",
  {
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "creator_terms_acceptances_pkey",
      columns: [t.communityId, t.userId, t.version],
    }),
    index("creator_terms_acceptances_user_idx").on(t.userId),
    check(
      "creator_terms_acceptances_version_length",
      sql`char_length(${t.version}) between 1 and ${sql.raw(String(termsVersionMaxLength))}`,
    ),
    pgPolicy("creator_terms_acceptances_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isPaymentsManager}`,
    }),
    pgPolicy("creator_terms_acceptances_accept", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser} and ${isPaymentsManager}`,
    }),
  ],
);

export type CreatorTermsAcceptance = typeof creatorTermsAcceptances.$inferSelect;
