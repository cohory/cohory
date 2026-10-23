import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./columns";
import { tenant } from "./communities";
import { auditVia } from "./manage";
import { oauthGrants } from "./oauth";

export const agentStatus = pgEnum("agent_status", ["active", "suspended", "revoked"]);
export const apiTokenKind = pgEnum("api_token_kind", ["personal", "agent"]);

export type AgentStatus = (typeof agentStatus.enumValues)[number];
export type ApiTokenKind = (typeof apiTokenKind.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const tokenHash = sql`nullif(current_setting('app.api_token_hash', true), '')`;
const tokenOwner = sql`nullif(current_setting('app.api_token_owner', true), '')::uuid`;

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

export const agentIdentities = pgTable(
  "agent_identities",
  {
    id: id(),
    communityId: tenant(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: agentStatus("status").notNull().default("active"),
    communityWide: boolean("community_wide").notNull().default(false),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("agent_identities_community_created_idx").on(t.communityId, t.createdAt),
    index("agent_identities_community_owner_idx").on(t.communityId, t.ownerId),
    index("agent_identities_owner_id_idx").on(t.ownerId),
    index("agent_identities_created_by_idx").on(t.createdBy),
    check("agent_identities_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check(
      "agent_identities_description_length",
      sql`${t.description} is null or char_length(${t.description}) <= 280`,
    ),
    pgPolicy("agent_identities_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    communityId: tenant(),
    kind: apiTokenKind("kind").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    agentId: uuid("agent_id").references(() => agentIdentities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedVia: auditVia("last_used_via"),
    expiryNotifiedAt: timestamp("expiry_notified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    oauthGrantId: uuid("oauth_grant_id").references((): AnyPgColumn => oauthGrants.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    index("api_tokens_community_grant_idx")
      .on(t.communityId, t.oauthGrantId)
      .where(sql`${t.oauthGrantId} is not null`),
    index("api_tokens_oauth_grant_id_idx")
      .on(t.oauthGrantId)
      .where(sql`${t.oauthGrantId} is not null`),
    check("api_tokens_oauth_agent", sql`${t.oauthGrantId} is null or ${t.kind} = 'agent'`),
    index("api_tokens_community_user_idx").on(t.communityId, t.userId, t.createdAt),
    index("api_tokens_community_agent_idx")
      .on(t.communityId, t.agentId)
      .where(sql`${t.agentId} is not null`),
    index("api_tokens_user_id_idx").on(t.userId),
    index("api_tokens_agent_id_idx").on(t.agentId),
    index("api_tokens_created_by_idx").on(t.createdBy),
    index("api_tokens_revoked_by_idx")
      .on(t.revokedBy)
      .where(sql`${t.revokedBy} is not null`),
    check("api_tokens_kind_agent", sql`(${t.kind} = 'agent') = (${t.agentId} is not null)`),
    check("api_tokens_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check("api_tokens_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("api_tokens_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("api_tokens_lookup", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.tokenHash} = ${tokenHash}`,
    }),
    pgPolicy("api_tokens_owner_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.kind} = 'personal' and ${t.userId} = ${tokenOwner}`,
    }),
    pgPolicy("api_tokens_owner_revoke", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${t.kind} = 'personal' and ${t.userId} = ${tokenOwner}`,
      withCheck: sql`${t.kind} = 'personal' and ${t.userId} = ${tokenOwner}`,
    }),
  ],
);

export type AgentIdentity = typeof agentIdentities.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
