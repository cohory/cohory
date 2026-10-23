CREATE TYPE "public"."event_rsvp_status" AS ENUM('going', 'not_going');--> statement-breakpoint
CREATE TABLE "event_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "event_occurrences_event_starts_unique" UNIQUE("event_id","starts_at"),
	CONSTRAINT "event_occurrences_ends_after_start" CHECK ("event_occurrences"."ends_at" > "event_occurrences"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "event_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"community_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "event_rsvp_status" NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_pkey" PRIMARY KEY("occurrence_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"slug" "citext" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at_local" timestamp NOT NULL,
	"time_zone" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"recurrence" text,
	"recurrence_until" date,
	"location" text,
	"recording_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_community_slug_unique" UNIQUE("community_id","slug"),
	CONSTRAINT "events_title_length" CHECK (char_length("events"."title") between 1 and 120),
	CONSTRAINT "events_description_length" CHECK (char_length("events"."description") <= 5000),
	CONSTRAINT "events_duration_range" CHECK ("events"."duration_minutes" between 5 and 1440),
	CONSTRAINT "events_recurrence_values" CHECK ("events"."recurrence" is null or "events"."recurrence" = 'weekly'),
	CONSTRAINT "events_location_length" CHECK (char_length("events"."location") <= 500),
	CONSTRAINT "events_recording_url_length" CHECK (char_length("events"."recording_url") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."event_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_occurrences_community_starts_idx" ON "event_occurrences" USING btree ("community_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_occurrences_starts_idx" ON "event_occurrences" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "event_rsvps_community_user_idx" ON "event_rsvps" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_user_id_idx" ON "event_rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_community_created_idx" ON "events" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE POLICY "event_occurrences_read" ON "event_occurrences" AS PERMISSIVE FOR SELECT TO public USING ("event_occurrences"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_occurrences_manage" ON "event_occurrences" AS PERMISSIVE FOR ALL TO public USING ("event_occurrences"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_manager', true), '') = 'on') WITH CHECK ("event_occurrences"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "event_occurrences_job_scan" ON "event_occurrences" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.calendar_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "event_rsvps_read" ON "event_rsvps" AS PERMISSIVE FOR SELECT TO public USING ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_rsvps_own_write" ON "event_rsvps" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "event_rsvps"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_rsvps_own_update" ON "event_rsvps" AS PERMISSIVE FOR UPDATE TO public USING ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "event_rsvps"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "event_rsvps"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_rsvps_own_delete" ON "event_rsvps" AS PERMISSIVE FOR DELETE TO public USING ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "event_rsvps"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_rsvps_job_update" ON "event_rsvps" AS PERMISSIVE FOR UPDATE TO public USING ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_jobs', true), '') = 'on') WITH CHECK ("event_rsvps"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "events_read" ON "events" AS PERMISSIVE FOR SELECT TO public USING ("events"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "events_manage" ON "events" AS PERMISSIVE FOR ALL TO public USING ("events"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_manager', true), '') = 'on') WITH CHECK ("events"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.calendar_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_occurrences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_rsvps" FORCE ROW LEVEL SECURITY;
