import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { citext, id, timestamps } from "./columns";
import { tenant } from "./communities";

export const eventRsvpStatus = pgEnum("event_rsvp_status", ["going", "not_going"]);

export type EventRsvpStatus = (typeof eventRsvpStatus.enumValues)[number];

const currentCommunity = sql`nullif(current_setting('app.community_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isManager = sql`coalesce(current_setting('app.calendar_manager', true), '') = 'on'`;
const isJob = sql`coalesce(current_setting('app.calendar_jobs', true), '') = 'on'`;

function inCommunity(communityId: AnyPgColumn): SQL {
  return sql`${communityId} = ${currentCommunity}`;
}

function readPolicy(name: string, communityId: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "select",
    to: "public",
    using: inCommunity(communityId),
  });
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

export const events = pgTable(
  "events",
  {
    id: id(),
    communityId: tenant(),
    slug: citext("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAtLocal: timestamp("starts_at_local", { withTimezone: false, mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    recurrence: text("recurrence"),
    recurrenceUntil: date("recurrence_until", { mode: "string" }),
    location: text("location"),
    recordingUrl: text("recording_url"),
    coverKey: text("cover_key"),
    ...timestamps,
  },
  (t) => [
    unique("events_community_slug_unique").on(t.communityId, t.slug),
    index("events_community_created_idx").on(t.communityId, t.createdAt),
    check("events_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("events_description_length", sql`char_length(${t.description}) <= 5000`),
    check("events_duration_range", sql`${t.durationMinutes} between 5 and 1440`),
    check("events_recurrence_values", sql`${t.recurrence} is null or ${t.recurrence} = 'weekly'`),
    check("events_location_length", sql`char_length(${t.location}) <= 500`),
    check("events_recording_url_length", sql`char_length(${t.recordingUrl}) <= 2000`),
    readPolicy("events_read", t.communityId),
    managerPolicy("events_manage", t.communityId),
  ],
);

export const eventOccurrences = pgTable(
  "event_occurrences",
  {
    id: id(),
    communityId: tenant(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => [
    unique("event_occurrences_event_starts_unique").on(t.eventId, t.startsAt),
    index("event_occurrences_community_starts_idx").on(t.communityId, t.startsAt),
    index("event_occurrences_starts_idx").on(t.startsAt),
    check("event_occurrences_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    readPolicy("event_occurrences_read", t.communityId),
    managerPolicy("event_occurrences_manage", t.communityId),
    pgPolicy("event_occurrences_job_scan", {
      as: "permissive",
      for: "select",
      to: "public",
      using: isJob,
    }),
  ],
);

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    communityId: tenant(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: eventRsvpStatus("status").notNull(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "event_rsvps_pkey", columns: [t.occurrenceId, t.userId] }),
    index("event_rsvps_community_user_idx").on(t.communityId, t.userId),
    index("event_rsvps_user_id_idx").on(t.userId),
    readPolicy("event_rsvps_read", t.communityId),
    pgPolicy("event_rsvps_own_write", {
      as: "permissive",
      for: "insert",
      to: "public",
      withCheck: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("event_rsvps_own_update", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
      withCheck: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("event_rsvps_own_delete", {
      as: "permissive",
      for: "delete",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${t.userId} = ${currentUser}`,
    }),
    pgPolicy("event_rsvps_job_update", {
      as: "permissive",
      for: "update",
      to: "public",
      using: sql`${inCommunity(t.communityId)} and ${isJob}`,
      withCheck: sql`${inCommunity(t.communityId)} and ${isJob}`,
    }),
  ],
);
