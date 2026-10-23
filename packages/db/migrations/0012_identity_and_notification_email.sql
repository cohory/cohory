CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_outcome" AS ENUM('sent', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_email_mode" AS ENUM('immediate', 'daily', 'off');--> statement-breakpoint
CREATE TABLE "account_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"outcome" "notification_delivery_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" "notification_email_mode" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"digest_hour" smallint DEFAULT 8 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"last_digest_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_digest_hour_range" CHECK ("notification_settings"."digest_hour" between 0 and 23),
	CONSTRAINT "notification_settings_time_zone_length" CHECK (char_length("notification_settings"."time_zone") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_audit_log" ADD CONSTRAINT "account_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_audit_log_user_created_idx" ON "account_audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "users_deletion_due_idx" ON "users" USING btree ("deletion_scheduled_for") WHERE "users"."deletion_scheduled_for" is not null and "users"."erased_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "notifications_own_rows_delete" ON "notifications" AS PERMISSIVE FOR DELETE TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_job_scan" ON "notifications" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.notification_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "account_audit_log_own_rows" ON "account_audit_log" AS PERMISSIVE FOR ALL TO public USING ("account_audit_log"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("account_audit_log"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_deliveries_own_rows" ON "notification_deliveries" AS PERMISSIVE FOR ALL TO public USING ("notification_deliveries"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("notification_deliveries"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_deliveries_job_scan" ON "notification_deliveries" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.notification_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "notification_preferences_own_rows" ON "notification_preferences" AS PERMISSIVE FOR ALL TO public USING ("notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_preferences_job_scan" ON "notification_preferences" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.notification_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "notification_settings_own_rows" ON "notification_settings" AS PERMISSIVE FOR ALL TO public USING ("notification_settings"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("notification_settings"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_settings_job_scan" ON "notification_settings" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.notification_jobs', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "account_audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
