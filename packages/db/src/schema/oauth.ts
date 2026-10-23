import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { agentIdentities } from "./agents";
import { users } from "./auth";
import { id } from "./columns";
import { tenant } from "./communities";

export const oauthGrantEndReason = pgEnum("oauth_grant_end_reason", [
  "disconnected",
  "revoked",
  "refresh_reuse",
  "code_reuse",
]);

export type OAuthGrantEndReason = (typeof oauthGrantEndReason.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const secretHash = sql`nullif(current_setting('app.oauth_secret_hash', true), '')`;
const grantOwner = sql`nullif(current_setting('app.oauth_grant_owner', true), '')::uuid`;

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: id(),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    clientUri: text("client_uri"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("oauth_clients_name_length", sql`char_length(${t.clientName}) between 1 and 100`),
    check("oauth_clients_redirect_count", sql`cardinality(${t.redirectUris}) between 1 and 10`),
    index("oauth_clients_created_idx").on(t.createdAt),
  ],
);

export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id(),
    communityId: tenant(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    agentId: uuid("agent_id")
      .notNull()
      .references((): AnyPgColumn => agentIdentities.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    resource: text("resource").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
    endReason: oauthGrantEndReason("end_reason"),
  },
  (t) => [
    index("oauth_grants_community_user_idx").on(t.communityId, t.userId, t.createdAt),
    index("oauth_grants_community_agent_idx").on(t.communityId, t.agentId),
    index("oauth_grants_client_id_idx").on(t.clientId),
    index("oauth_grants_user_id_idx").on(t.userId),
    index("oauth_grants_agent_id_idx").on(t.agentId),
    index("oauth_grants_ended_by_idx")
      .on(t.endedBy)
      .where(sql`${t.endedBy} is not null`),
    check("oauth_grants_end_consistent", sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    pgPolicy("oauth_grants_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("oauth_grants_owner_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.userId} = ${grantOwner}`,
    }),
  ],
);

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: id(),
    communityId: tenant(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_codes_community_grant_idx").on(t.communityId, t.grantId),
    index("oauth_codes_grant_id_idx").on(t.grantId),
    check("oauth_codes_hash_format", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("oauth_codes_challenge_format", sql`${t.codeChallenge} ~ '^[A-Za-z0-9_-]{43}$'`),
    pgPolicy("oauth_codes_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("oauth_codes_lookup", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.codeHash} = ${secretHash}`,
    }),
  ],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: id(),
    communityId: tenant(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_refresh_community_grant_idx").on(t.communityId, t.grantId),
    index("oauth_refresh_grant_id_idx").on(t.grantId),
    check("oauth_refresh_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("oauth_refresh_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("oauth_refresh_lookup", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.tokenHash} = ${secretHash}`,
    }),
  ],
);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
