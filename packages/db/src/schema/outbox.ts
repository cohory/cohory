import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { id } from "./columns";
import { communities } from "./communities";

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isRelay = sql`coalesce(current_setting('app.outbox_relay', true), '') = 'on'`;

export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outbox_community_idx").on(t.communityId, t.createdAt),
    index("outbox_pending_idx")
      .on(t.createdAt, t.id)
      .where(sql`${t.publishedAt} is null`),
    index("outbox_published_idx")
      .on(t.publishedAt)
      .where(sql`${t.publishedAt} is not null`),
    pgPolicy("outbox_append", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} is null or ${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("outbox_relay", {
      as: "permissive",
      for: "all",
      to: "public",
      using: isRelay,
      withCheck: isRelay,
    }),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
