import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { agentIdentities } from "./agents";
import { users } from "./auth";
import { citext, id, timestamps, tsvector } from "./columns";
import { tenant } from "./communities";
import { accountPurgeOwnRows } from "./identity";

export interface ContentDocumentJson {
  readonly type: "doc";
  readonly content: readonly unknown[];
}

export const reactionSubjectType = pgEnum("reaction_subject_type", ["post", "comment"]);
export const reactionKind = pgEnum("reaction_kind", ["like"]);

export const categoryColor = pgEnum("category_color", [
  "neutral",
  "accent",
  "info",
  "success",
  "warning",
  "danger",
]);

export type CategoryColor = (typeof categoryColor.enumValues)[number];

export type ReactionSubjectType = (typeof reactionSubjectType.enumValues)[number];
export type ReactionKind = (typeof reactionKind.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isNotificationJob = sql`coalesce(current_setting('app.notification_jobs', true), '') = 'on'`;

function tenantIsolation(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${communityId} = ${currentCommunity}`,
    withCheck: sql`${communityId} = ${currentCommunity}`,
  });
}

export const categories = pgTable(
  "categories",
  {
    id: id(),
    communityId: tenant(),
    name: text("name").notNull(),
    slug: citext("slug").notNull(),
    color: categoryColor("color").notNull().default("neutral"),
    position: integer("position").notNull(),
    staffOnly: boolean("staff_only").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("categories_community_slug_unique").on(t.communityId, t.slug),
    index("categories_community_position_idx").on(t.communityId, t.position),
    check("categories_name_length", sql`char_length(${t.name}) between 1 and 40`),
    tenantIsolation("categories_tenant_isolation", t.communityId),
  ],
);

const contentColumns = {
  body: jsonb("body").$type<ContentDocumentJson>().notNull(),
  bodyHtml: text("body_html").notNull(),
  bodyText: text("body_text").notNull(),
};

export const posts = pgTable(
  "posts",
  {
    id: id(),
    communityId: tenant(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    agentId: uuid("agent_id").references(() => agentIdentities.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    title: text("title"),
    ...contentColumns,
    excerpt: text("excerpt").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', body_text), 'B')`,
    ),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    commentCount: integer("comment_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("posts_deleted_by_idx")
      .on(t.deletedBy)
      .where(sql`${t.deletedBy} is not null`),
    uniqueIndex("posts_community_id_unique").on(t.communityId, t.id),
    index("posts_feed_v2_idx")
      .on(
        t.communityId,
        t.pinnedAt.desc().nullsLast(),
        t.createdAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.deletedAt} is null`),
    index("posts_activity_v2_idx")
      .on(
        t.communityId,
        t.pinnedAt.desc().nullsLast(),
        t.lastActivityAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.deletedAt} is null`),
    index("posts_top_v2_idx")
      .on(
        t.communityId,
        t.pinnedAt.desc().nullsLast(),
        sql`(${t.likeCount} + 2 * ${t.commentCount}) desc`,
        t.createdAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.deletedAt} is null`),
    index("posts_category_feed_v2_idx")
      .on(
        t.communityId,
        t.categoryId,
        t.pinnedAt.desc().nullsLast(),
        t.createdAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.deletedAt} is null`),
    index("posts_category_id_idx").on(t.categoryId),
    index("posts_scheduled_idx")
      .on(t.communityId, t.scheduledAt, t.id)
      .where(sql`${t.scheduledAt} is not null and ${t.deletedAt} is null`),
    index("posts_scheduled_due_idx")
      .on(t.scheduledAt)
      .where(sql`${t.scheduledAt} is not null and ${t.deletedAt} is null`),
    index("posts_search_idx").using("gin", t.searchVector),
    index("posts_author_id_idx").on(t.authorId),
    index("posts_agent_idx")
      .on(t.communityId, t.agentId)
      .where(sql`${t.agentId} is not null`),
    index("posts_agent_id_idx")
      .on(t.agentId)
      .where(sql`${t.agentId} is not null`),
    check("posts_title_length", sql`char_length(${t.title}) <= 120`),
    check("posts_counts_nonnegative", sql`${t.commentCount} >= 0 and ${t.likeCount} >= 0`),
    tenantIsolation("posts_tenant_isolation", t.communityId),
    pgPolicy("posts_scheduler_read", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`coalesce(current_setting('app.posts_scheduler', true), '') = 'on' and ${t.scheduledAt} is not null`,
    }),
  ],
);

export const postImages = pgTable(
  "post_images",
  {
    id: id(),
    communityId: tenant(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("post_images_post_position_unique").on(t.postId, t.position),
    index("post_images_post_idx").on(t.communityId, t.postId, t.position),
    check("post_images_position_range", sql`${t.position} >= 0 and ${t.position} < 10`),
    tenantIsolation("post_images_tenant_isolation", t.communityId),
  ],
);

export const postDrafts = pgTable(
  "post_drafts",
  {
    id: id(),
    communityId: tenant(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    agentId: uuid("agent_id").references(() => agentIdentities.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    title: text("title"),
    ...contentColumns,
    excerpt: text("excerpt").notNull(),
    ...timestamps,
  },
  (t) => [
    index("post_drafts_community_author_idx").on(t.communityId, t.authorId, t.createdAt),
    index("post_drafts_author_id_idx").on(t.authorId),
    index("post_drafts_agent_id_idx").on(t.agentId),
    index("post_drafts_category_id_idx").on(t.categoryId),
    check("post_drafts_title_length", sql`char_length(${t.title}) <= 120`),
    tenantIsolation("post_drafts_tenant_isolation", t.communityId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    communityId: tenant(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    agentId: uuid("agent_id").references(() => agentIdentities.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    ...contentColumns,
    likeCount: integer("like_count").notNull().default(0),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', body_text)`,
    ),
    ...timestamps,
  },
  (t) => [
    index("comments_search_idx").using("gin", t.searchVector),
    index("comments_deleted_by_idx")
      .on(t.deletedBy)
      .where(sql`${t.deletedBy} is not null`),
    index("comments_post_idx").on(t.communityId, t.postId, t.createdAt, t.id),
    index("comments_post_id_idx").on(t.postId),
    index("comments_parent_id_idx").on(t.parentId),
    index("comments_author_id_idx").on(t.authorId),
    index("comments_agent_idx")
      .on(t.communityId, t.agentId)
      .where(sql`${t.agentId} is not null`),
    index("comments_agent_id_idx")
      .on(t.agentId)
      .where(sql`${t.agentId} is not null`),
    check("comments_like_count_nonnegative", sql`${t.likeCount} >= 0`),
    tenantIsolation("comments_tenant_isolation", t.communityId),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: id(),
    communityId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    subjectType: reactionSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    subjectAuthorId: uuid("subject_author_id").notNull(),
    kind: reactionKind("kind").notNull().default("like"),
    ...timestamps,
  },
  (t) => [
    unique("reactions_subject_user_kind_unique").on(t.subjectType, t.subjectId, t.userId, t.kind),
    index("reactions_subject_idx").on(t.communityId, t.subjectType, t.subjectId),
    index("reactions_user_id_idx").on(t.userId),
    tenantIsolation("reactions_tenant_isolation", t.communityId),
  ],
);

export const postFollows = pgTable(
  "post_follows",
  {
    communityId: tenant(),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "post_follows_post_fk",
      columns: [t.communityId, t.postId],
      foreignColumns: [posts.communityId, posts.id],
    }).onDelete("cascade"),
    primaryKey({ name: "post_follows_pkey", columns: [t.postId, t.userId] }),
    index("post_follows_community_user_idx").on(t.communityId, t.userId),
    index("post_follows_user_id_idx").on(t.userId),
    pgPolicy("post_follows_own_rows", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser}`,
      withCheck: sql`${t.communityId} = ${currentCommunity} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("post_follows_notification_scan", {
      as: "permissive",
      for: "select",
      to: "public",
      using: sql`${t.communityId} = ${currentCommunity} and ${isNotificationJob}`,
    }),
    pgPolicy("post_follows_account_purge", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
      withCheck: sql`${t.userId} = ${currentUser} and ${accountPurgeOwnRows}`,
    }),
  ],
);

export type PostFollow = typeof postFollows.$inferSelect;
export type Category = typeof categories.$inferSelect;
