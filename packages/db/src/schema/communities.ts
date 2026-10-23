import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { users } from "./auth";
import { citext, id, timestamps } from "./columns";
import type { JoinAnswerJson } from "./joining";
import type { ContentDocumentJson } from "./posts";

export const fontOptions = ["inter", "source-serif", "nunito-sans"] as const;
export const cardStyleOptions = ["minimal", "soft"] as const;
export const themeOptions = ["light", "dark", "system"] as const;

export type FontOption = (typeof fontOptions)[number];
export type CardStyleOption = (typeof cardStyleOptions)[number];
export type ThemeOption = (typeof themeOptions)[number];

export const communityAppearanceSchema = z.object({
  accent: z.string().nullable().optional(),
  logoKey: z.string().nullable().optional(),
  coverKey: z.string().nullable().optional(),
  font: z.enum(fontOptions).optional(),
  cardStyle: z.enum(cardStyleOptions).optional(),
  theme: z.enum(themeOptions).optional(),
});

export type CommunityAppearance = z.infer<typeof communityAppearanceSchema>;

export const maxJoinQuestions = 3;
export const joinQuestionMaxLength = 200;

export const joinQuestionSchema = z.strictObject({
  text: z.string().trim().min(1).max(joinQuestionMaxLength),
  required: z.boolean(),
});

export const joinQuestionsSchema = z.array(joinQuestionSchema).max(maxJoinQuestions);

export type JoinQuestion = z.infer<typeof joinQuestionSchema>;

export const maxWhatYouGetItems = 6;
export const whatYouGetItemMaxLength = 80;
export const maxFaqItems = 8;
export const faqQuestionMaxLength = 200;
export const faqAnswerMaxLength = 1000;
export const hostBioMaxLength = 600;
export const hostCredentialMaxLength = 120;
export const refundPolicyMaxLength = 280;

export const whatYouGetSchema = z
  .array(z.string().trim().min(1).max(whatYouGetItemMaxLength))
  .max(maxWhatYouGetItems);

export const faqItemSchema = z.strictObject({
  q: z.string().trim().min(1).max(faqQuestionMaxLength),
  a: z.string().trim().min(1).max(faqAnswerMaxLength),
});

export const faqSchema = z.array(faqItemSchema).max(maxFaqItems);

export type FaqItem = z.infer<typeof faqItemSchema>;

const hexColor = z.string().regex(/^#[0-9A-F]{6}$/);

export const accentModeTokensSchema = z.object({
  accent: hexColor,
  accentHover: hexColor,
  accentForeground: hexColor,
  accentMuted: hexColor,
  ring: hexColor,
});

export type AccentModeTokens = z.infer<typeof accentModeTokensSchema>;

const contrastRatiosSchema = z.object({
  accentOnBackground: z.number(),
  foregroundOnAccent: z.number(),
  accentOnMuted: z.number(),
});

export const appearanceTokensSchema = z.object({
  light: accentModeTokensSchema,
  dark: accentModeTokensSchema,
  ratios: z.object({ light: contrastRatiosSchema, dark: contrastRatiosSchema }),
  font: z.enum(fontOptions),
  cardStyle: z.enum(cardStyleOptions),
  theme: z.enum(themeOptions),
  fallbackUsed: z.boolean(),
  warning: z.enum(["red_hue"]).nullable(),
});

export type AppearanceTokens = z.infer<typeof appearanceTokensSchema>;

export const defaultLevelNames = [
  "Level 1",
  "Level 2",
  "Level 3",
  "Level 4",
  "Level 5",
  "Level 6",
  "Level 7",
  "Level 8",
  "Level 9",
] as const;

export const communityPrivacy = pgEnum("community_privacy", ["private", "public"]);
export const joinMode = pgEnum("join_mode", ["open", "approval", "invite"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "moderator", "member"]);
export const memberStatus = pgEnum("member_status", ["pending", "active", "removed", "banned"]);

export const memberRemovalReason = pgEnum("member_removal_reason", [
  "left",
  "removed",
  "hold_expired",
]);

export type CommunityPrivacy = (typeof communityPrivacy.enumValues)[number];
export type JoinMode = (typeof joinMode.enumValues)[number];
export type MemberRole = (typeof memberRole.enumValues)[number];
export type MemberStatus = (typeof memberStatus.enumValues)[number];

export type MemberRemovalReason = (typeof memberRemovalReason.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

export const isCommunityPurge = sql`coalesce(current_setting('app.community_purge', true), '') = 'on'`;

export const communities = pgTable(
  "communities",
  {
    id: id(),
    slug: citext("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    detailedDescription: jsonb("detailed_description").$type<ContentDocumentJson>(),
    privacy: communityPrivacy("privacy").notNull().default("private"),
    joinMode: joinMode("join_mode").notNull().default("open"),
    joinQuestions: jsonb("join_questions").$type<JoinQuestion[]>(),
    appearance: jsonb("appearance")
      .$type<CommunityAppearance>()
      .notNull()
      .$defaultFn(() => ({})),
    appearanceTokens: jsonb("appearance_tokens").$type<AppearanceTokens>(),
    gamificationEnabled: boolean("gamification_enabled").notNull().default(true),
    reviewsEnabled: boolean("reviews_enabled").notNull().default(false),
    levelNames: jsonb("level_names")
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => [...defaultLevelNames]),
    currency: char("currency", { length: 3 }),
    slugChangedAt: timestamp("slug_changed_at", { withTimezone: true }),
    whatYouGet: jsonb("what_you_get").$type<string[]>(),
    hostBio: text("host_bio"),
    hostCredential: text("host_credential"),
    faq: jsonb("faq").$type<FaqItem[]>(),
    setupChecklistHiddenAt: timestamp("setup_checklist_hidden_at", { withTimezone: true }),
    setupImportSkippedAt: timestamp("setup_import_skipped_at", { withTimezone: true }),
    aboutPreviewedAt: timestamp("about_previewed_at", { withTimezone: true }),
    inviteLinkCopiedAt: timestamp("invite_link_copied_at", { withTimezone: true }),
    testCheckoutSucceededAt: timestamp("test_checkout_succeeded_at", { withTimezone: true }),
    refundPolicy: text("refund_policy"),
    pointsForLessons: boolean("points_for_lessons").notNull().default(false),
    pointsForEvents: boolean("points_for_events").notNull().default(false),
    memberEmailSentAt: timestamp("member_email_sent_at", { withTimezone: true }),
    memberEmailSentBy: uuid("member_email_sent_by").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgeAttemptedAt: timestamp("purge_attempted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("communities_purge_queue_idx")
      .on(t.purgeAttemptedAt.asc().nullsFirst(), t.deletedAt, t.id)
      .where(sql`${t.deletedAt} is not null`),
    index("communities_member_email_sent_by_idx")
      .on(t.memberEmailSentBy)
      .where(sql`${t.memberEmailSentBy} is not null`),
    check(
      "communities_refund_policy_length",
      sql`char_length(${t.refundPolicy}) between 1 and ${sql.raw(String(refundPolicyMaxLength))}`,
    ),
    check(
      "communities_member_email_sent",
      sql`${t.memberEmailSentBy} is null or ${t.memberEmailSentAt} is not null`,
    ),
    check(
      "communities_what_you_get_limit",
      sql`${t.whatYouGet} is null or (jsonb_typeof(${t.whatYouGet}) = 'array' and jsonb_array_length(${t.whatYouGet}) <= ${sql.raw(String(maxWhatYouGetItems))})`,
    ),
    check(
      "communities_faq_limit",
      sql`${t.faq} is null or (jsonb_typeof(${t.faq}) = 'array' and jsonb_array_length(${t.faq}) <= ${sql.raw(String(maxFaqItems))})`,
    ),
    check(
      "communities_host_bio_length",
      sql`char_length(${t.hostBio}) <= ${sql.raw(String(hostBioMaxLength))}`,
    ),
    check(
      "communities_host_credential_length",
      sql`char_length(${t.hostCredential}) <= ${sql.raw(String(hostCredentialMaxLength))}`,
    ),
    pgPolicy("communities_readable", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`true`,
    }),
    pgPolicy("communities_tenant_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.id} = ${currentCommunity}`,
    }),
    pgPolicy("communities_tenant_update", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${t.id} = ${currentCommunity}`,
      withCheck: sql`${t.id} = ${currentCommunity}`,
    }),
    pgPolicy("communities_tenant_delete", {
      as: "permissive",
      for: "delete",
      to: "public",
      using: sql`${t.id} = ${currentCommunity}`,
    }),
  ],
);

export const tenant = () =>
  uuid("community_id")
    .notNull()
    .references(() => communities.id, { onDelete: "cascade" });

export const detachedTenant = () =>
  uuid("community_id").references(() => communities.id, { onDelete: "set null" });

export const formerCommunity = () => ({
  formerCommunityId: uuid("former_community_id"),
  formerCommunityName: text("former_community_name"),
});

export function detachSnapshotWrite(table: string, communityId: AnyPgColumn) {
  const scoped = sql`${communityId} = ${currentCommunity} and coalesce(current_setting('app.payments_detach', true), '') = 'on'`;
  return pgPolicy(`${table}_detach`, {
    as: "permissive",
    for: "update",
    to: "public",
    using: scoped,
    withCheck: scoped,
  });
}

export function communityOrFormer(
  table: string,
  communityId: AnyPgColumn,
  formerCommunityId: AnyPgColumn,
) {
  return [
    check(
      `${table}_community_or_former`,
      sql`${communityId} is not null or ${formerCommunityId} is not null`,
    ),
    check(
      `${table}_former_matches`,
      sql`${formerCommunityId} is null or ${communityId} is null or ${formerCommunityId} = ${communityId}`,
    ),
  ];
}

// Imported members carry bare answers (the source platform drops the questions); members who
// answered before checkout carry each question with its answer.
export type MembershipJoinAnswers = string[] | JoinAnswerJson[];

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: memberRole("role").notNull().default("member"),
    status: memberStatus("status").notNull(),
    removalReason: memberRemovalReason("removal_reason"),
    joinAnswers: jsonb("join_answers").$type<MembershipJoinAnswers>(),
    bio: text("bio"),
    bannedEmail: citext("banned_email"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastFeedVisitAt: timestamp("last_feed_visit_at", { withTimezone: true }),
    onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
    welcomeEmailSentAt: timestamp("welcome_email_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("memberships_community_user_unique").on(t.communityId, t.userId),
    uniqueIndex("memberships_one_owner_per_community")
      .on(t.communityId)
      .where(sql`${t.role} = 'owner'`),
    index("memberships_user_id_idx").on(t.userId),
    index("memberships_community_directory_idx")
      .on(
        t.communityId,
        sql`coalesce(${t.joinedAt}, ${t.createdAt}) desc`,
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.status} = 'active'`),
    index("memberships_community_last_seen_idx")
      .on(t.communityId, t.lastSeenAt)
      .where(sql`${t.status} = 'active'`),
    index("memberships_community_banned_email_idx")
      .on(t.communityId, t.bannedEmail)
      .where(sql`${t.bannedEmail} is not null`),
    check(
      "memberships_banned_email_only_when_banned",
      sql`${t.bannedEmail} is null or ${t.status} = 'banned'`,
    ),
    check("memberships_bio_length", sql`char_length(${t.bio}) <= 500`),
    check(
      "memberships_removal_reason_only_when_removed",
      sql`${t.removalReason} is null or ${t.status} = 'removed'`,
    ),
    index("memberships_bio_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.bio}, ''))`,
    ),
    pgPolicy("memberships_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity}`,
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
    pgPolicy("memberships_own_rows", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);

export const communitySlugHistory = pgTable(
  "community_slug_history",
  {
    slug: citext("slug").primaryKey(),
    communityId: tenant(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("community_slug_history_community_changed_idx").on(t.communityId, t.changedAt),
    pgPolicy("community_slug_history_readable", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`true`,
    }),
    pgPolicy("community_slug_history_tenant_insert", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${t.communityId} = ${currentCommunity}`,
    }),
  ],
);

export type CommunitySlugHistory = typeof communitySlugHistory.$inferSelect;

export const galleryItemKind = pgEnum("gallery_item_kind", ["image", "video_embed"]);

export type GalleryItemKind = (typeof galleryItemKind.enumValues)[number];

export const maxGalleryItems = 10;
export const galleryAltTextMaxLength = 250;

const isCommunityManager = sql`coalesce(current_setting('app.community_manager', true), '') = 'on'`;

export const communityGalleryItems = pgTable(
  "community_gallery_items",
  {
    id: id(),
    communityId: tenant(),
    kind: galleryItemKind("kind").notNull(),
    storageKey: text("storage_key"),
    embedUrl: text("embed_url"),
    thumbnailUrl: text("thumbnail_url"),
    position: integer("position").notNull(),
    altText: text("alt_text"),
    ...timestamps,
  },
  (t) => [
    index("community_gallery_items_community_position_idx").on(t.communityId, t.position),
    check(
      "community_gallery_items_source",
      sql`(${t.kind} = 'image' and ${t.storageKey} is not null and ${t.embedUrl} is null) or (${t.kind} = 'video_embed' and ${t.embedUrl} is not null and ${t.storageKey} is null)`,
    ),
    check("community_gallery_items_position_range", sql`${t.position} >= 0`),
    check(
      "community_gallery_items_alt_text_length",
      sql`char_length(${t.altText}) <= ${sql.raw(String(galleryAltTextMaxLength))}`,
    ),
    pgPolicy("community_gallery_items_readable", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`true`,
    }),
    pgPolicy("community_gallery_items_manage", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isCommunityManager}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${isCommunityManager}`,
    }),
  ],
);

export type CommunityGalleryItem = typeof communityGalleryItems.$inferSelect;
