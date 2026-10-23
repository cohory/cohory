import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id } from "./columns";
import { memberships, tenant } from "./communities";

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.community_manager', true), '') = 'on'`;
const inviteToken = sql`nullif(current_setting('app.invite_token', true), '')`;
const isHoldSweep = sql`coalesce(current_setting('app.membership_hold_sweep', true), '') = 'on'`;

export const inviteLinkLabelMaxLength = 60;

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

export const inviteLinks = pgTable(
  "invite_links",
  {
    id: id(),
    communityId: tenant(),
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invite_links_community_created_idx").on(t.communityId, t.createdAt),
    index("invite_links_created_by_idx").on(t.createdBy),
    uniqueIndex("invite_links_community_id_unique").on(t.communityId, t.id),
    check(
      "invite_links_label_length",
      sql`${t.label} is null or char_length(${t.label}) between 1 and ${sql.raw(String(inviteLinkLabelMaxLength))}`,
    ),
    check("invite_links_max_uses_positive", sql`${t.maxUses} is null or ${t.maxUses} > 0`),
    check(
      "invite_links_use_count_range",
      sql`${t.useCount} >= 0 and (${t.maxUses} is null or ${t.useCount} <= ${t.maxUses})`,
    ),
    pgPolicy("invite_links_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isManager}`,
      withCheck: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
    pgPolicy("invite_links_redeem_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.token} = ${inviteToken}`,
    }),
    pgPolicy("invite_links_redeem_update", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${t.token} = ${inviteToken} and ${inCommunity(t.communityId)}`,
      withCheck: sql`${t.token} = ${inviteToken} and ${inCommunity(t.communityId)}`,
    }),
  ],
);

export const membershipHolds = pgTable(
  "membership_holds",
  {
    communityId: tenant(),
    userId: uuid("user_id").notNull(),
    inviteId: uuid("invite_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "membership_holds_pkey", columns: [t.communityId, t.userId] }),
    foreignKey({
      name: "membership_holds_membership_fk",
      columns: [t.communityId, t.userId],
      foreignColumns: [memberships.communityId, memberships.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_holds_invite_fk",
      columns: [t.communityId, t.inviteId],
      foreignColumns: [inviteLinks.communityId, inviteLinks.id],
    }).onDelete("cascade"),
    index("membership_holds_community_invite_idx").on(t.communityId, t.inviteId),
    index("membership_holds_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.releasedAt} is null`),
    pgPolicy("membership_holds_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: inCommunity(t.communityId),
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("membership_holds_sweep_scan", {
      as: "permissive",
      for: "select",
      to: "public",
      using: isHoldSweep,
    }),
  ],
);

export type MembershipHold = typeof membershipHolds.$inferSelect;

export const auditActorType = pgEnum("audit_actor_type", ["user", "agent", "system"]);
export const auditVia = pgEnum("audit_via", ["web", "api", "mcp", "job"]);

export type AuditActorType = (typeof auditActorType.enumValues)[number];
export type AuditVia = (typeof auditVia.enumValues)[number];

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    communityId: tenant(),
    actorId: uuid("actor_id").references(() => users.id),
    actorType: auditActorType("actor_type"),
    via: auditVia("via"),
    tokenId: uuid("token_id"),
    agentId: uuid("agent_id"),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_community_created_idx").on(t.communityId, t.createdAt),
    index("audit_log_actor_id_idx")
      .on(t.actorId)
      .where(sql`${t.actorId} is not null`),
    index("audit_log_community_agent_idx")
      .on(t.communityId, t.agentId, t.createdAt)
      .where(sql`${t.agentId} is not null`),
    index("audit_log_community_token_idx")
      .on(t.communityId, t.tokenId, t.createdAt)
      .where(sql`${t.tokenId} is not null`),
    pgPolicy("audit_log_tenant_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: inCommunity(t.communityId),
    }),
    pgPolicy("audit_log_manager_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
  ],
);

export type InviteLink = typeof inviteLinks.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
