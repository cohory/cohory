import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { citext, id, timestamps, tsvector } from "./columns";
import { tenant } from "./communities";

export const courseStatus = pgEnum("course_status", ["draft", "published", "archived"]);
export const lessonStatus = pgEnum("lesson_status", ["draft", "published"]);

export type CourseStatus = (typeof courseStatus.enumValues)[number];
export type LessonStatus = (typeof lessonStatus.enumValues)[number];

export interface LessonAttachmentJson {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.course_manager', true), '') = 'on'`;

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

function managerPolicy(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${inCommunity(communityId)} and ${isManager}`,
    withCheck: sql`${inCommunity(communityId)} and ${isManager}`,
  });
}

function readPolicy(name: string, communityId: AnyPgColumn, condition?: SQL) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: condition ? sql`${inCommunity(communityId)} and ${condition}` : inCommunity(communityId),
  });
}

export const courses = pgTable(
  "courses",
  {
    id: id(),
    communityId: tenant(),
    slug: citext("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    coverKey: text("cover_key"),
    status: courseStatus("status").notNull().default("draft"),
    position: integer("position").notNull(),
    access: text("access").notNull().default("all_members"),
    requiredLevel: smallint("required_level"),
    ...timestamps,
  },
  (t) => [
    unique("courses_community_slug_unique").on(t.communityId, t.slug),
    unique("courses_community_id_unique").on(t.communityId, t.id),
    index("courses_community_position_idx").on(t.communityId, t.position),
    check("courses_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("courses_description_length", sql`char_length(${t.description}) <= 2000`),
    check("courses_access_values", sql`${t.access} = 'all_members'`),
    check("courses_required_level_range", sql`${t.requiredLevel} between 1 and 9`),
    readPolicy("courses_published_read", t.communityId, sql`${t.status} = 'published'`),
    managerPolicy("courses_manage", t.communityId),
  ],
);

export const courseModules = pgTable(
  "course_modules",
  {
    id: id(),
    communityId: tenant(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    index("course_modules_course_position_idx").on(t.communityId, t.courseId, t.position),
    index("course_modules_course_id_idx").on(t.courseId),
    check("course_modules_title_length", sql`char_length(${t.title}) between 1 and 120`),
    readPolicy("course_modules_read", t.communityId),
    managerPolicy("course_modules_manage", t.communityId),
  ],
);

export const lessons = pgTable(
  "lessons",
  {
    id: id(),
    communityId: tenant(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => courseModules.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    slug: citext("slug").notNull(),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown"),
    videoUrl: text("video_url"),
    attachments: jsonb("attachments").$type<LessonAttachmentJson[]>().notNull().default([]),
    status: lessonStatus("status").notNull().default("draft"),
    position: integer("position").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', coalesce(body_markdown, '')), 'B')`,
    ),
    ...timestamps,
  },
  (t) => [
    index("lessons_search_idx").using("gin", t.searchVector),
    unique("lessons_course_slug_unique").on(t.courseId, t.slug),
    index("lessons_module_position_idx").on(t.communityId, t.moduleId, t.position),
    index("lessons_course_idx").on(t.communityId, t.courseId),
    index("lessons_module_id_idx").on(t.moduleId),
    index("lessons_course_id_idx").on(t.courseId),
    check("lessons_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("lessons_body_length", sql`char_length(${t.bodyMarkdown}) <= 100000`),
    check("lessons_attachments_limit", sql`jsonb_array_length(${t.attachments}) <= 10`),
    readPolicy("lessons_published_read", t.communityId, sql`${t.status} = 'published'`),
    managerPolicy("lessons_manage", t.communityId),
  ],
);

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    communityId: tenant(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "lesson_progress_pkey", columns: [t.lessonId, t.userId] }),
    index("lesson_progress_recent_idx").on(t.communityId, t.userId, t.lastViewedAt.desc()),
    index("lesson_progress_course_idx").on(t.communityId, t.courseId),
    index("lesson_progress_user_id_idx").on(t.userId),
    index("lesson_progress_course_id_idx").on(t.courseId),
    pgPolicy("lesson_progress_own", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
      withCheck: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
    }),
    readPolicy("lesson_progress_manager_read", t.communityId, isManager),
  ],
);

export const lessonAgentLayers = pgTable(
  "lesson_agent_layers",
  {
    lessonId: uuid("lesson_id")
      .primaryKey()
      .references(() => lessons.id, { onDelete: "cascade" }),
    communityId: tenant(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    layer: jsonb("layer").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("lesson_agent_layers_course_idx").on(t.communityId, t.courseId),
    index("lesson_agent_layers_course_id_idx").on(t.courseId),
    index("lesson_agent_layers_updated_by_idx")
      .on(t.updatedBy)
      .where(sql`${t.updatedBy} is not null`),
    check("lesson_agent_layers_size", sql`octet_length(${t.layer}::text) <= 1048576`),
    managerPolicy("lesson_agent_layers_manage", t.communityId),
  ],
);

export const courseAgentVersions = pgTable(
  "course_agent_versions",
  {
    id: id(),
    communityId: tenant(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    patch: integer("patch").notNull(),
    changelog: text("changelog").notNull().default(""),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    checksum: text("checksum").notNull(),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("course_agent_versions_course_version_unique").on(
      t.communityId,
      t.courseId,
      t.major,
      t.minor,
      t.patch,
    ),
    index("course_agent_versions_course_id_idx").on(t.courseId),
    index("course_agent_versions_published_by_idx")
      .on(t.publishedBy)
      .where(sql`${t.publishedBy} is not null`),
    check(
      "course_agent_versions_version_parts",
      sql`${t.major} >= 0 and ${t.minor} >= 0 and ${t.patch} >= 0 and ${t.version} = ${t.major}::text || '.' || ${t.minor}::text || '.' || ${t.patch}::text`,
    ),
    check("course_agent_versions_checksum", sql`${t.checksum} ~ '^[0-9a-f]{64}$'`),
    check("course_agent_versions_changelog_length", sql`char_length(${t.changelog}) <= 2000`),
    check("course_agent_versions_size", sql`octet_length(${t.snapshot}::text) <= 3145728`),
    readPolicy("course_agent_versions_read", t.communityId),
    pgPolicy("course_agent_versions_publish", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${inCommunity(t.communityId)} and ${isManager}`,
    }),
  ],
);
