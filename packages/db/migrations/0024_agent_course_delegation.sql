CREATE TYPE "public"."delegation_end_reason" AS ENUM('revoked', 'expired', 'access_ended', 'agent_inactive', 'agent_access_off');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'course_delegation';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'agent_access';--> statement-breakpoint
CREATE TABLE "agent_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"task_id" text NOT NULL,
	"version" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"human_id" uuid NOT NULL,
	"delegation_id" uuid,
	"run_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"label" text DEFAULT 'self_reported' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_submissions_label" CHECK ("agent_submissions"."label" = 'self_reported'),
	CONSTRAINT "agent_submissions_lesson_id" CHECK (char_length("agent_submissions"."lesson_id") between 1 and 200),
	CONSTRAINT "agent_submissions_task_id" CHECK (char_length("agent_submissions"."task_id") between 1 and 200),
	CONSTRAINT "agent_submissions_version" CHECK (char_length("agent_submissions"."version") between 1 and 64),
	CONSTRAINT "agent_submissions_run_id" CHECK (char_length("agent_submissions"."run_id") between 1 and 200),
	CONSTRAINT "agent_submissions_payload_size" CHECK (octet_length("agent_submissions"."payload"::text) <= 65536)
);
--> statement-breakpoint
ALTER TABLE "agent_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "course_agent_settings" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"allow_agent_access" boolean DEFAULT false NOT NULL,
	"license_id" text DEFAULT 'personal_agents' NOT NULL,
	"license_text" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_agent_settings_license_id" CHECK ("course_agent_settings"."license_id" in ('personal_agents', 'team_agents', 'custom')),
	CONSTRAINT "course_agent_settings_license_text" CHECK ("course_agent_settings"."license_text" is null or char_length("course_agent_settings"."license_text") between 1 and 2000),
	CONSTRAINT "course_agent_settings_custom_text" CHECK ("course_agent_settings"."license_id" <> 'custom' or "course_agent_settings"."license_text" is not null)
);
--> statement-breakpoint
ALTER TABLE "course_agent_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "course_delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"human_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"renewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "delegation_end_reason",
	"revoked_by" uuid,
	"expiry_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_delegations_revoked" CHECK (("course_delegations"."revoked_at" is null) = ("course_delegations"."revoked_reason" is null)),
	CONSTRAINT "course_delegations_window" CHECK ("course_delegations"."expires_at" > "course_delegations"."granted_at")
);
--> statement-breakpoint
ALTER TABLE "course_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_community_id_unique" UNIQUE("community_id","id");--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_human_id_users_id_fk" FOREIGN KEY ("human_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_delegation_id_course_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."course_delegations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_course_fk" FOREIGN KEY ("community_id","course_id") REFERENCES "public"."courses"("community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_agent_settings" ADD CONSTRAINT "course_agent_settings_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_agent_settings" ADD CONSTRAINT "course_agent_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_agent_settings" ADD CONSTRAINT "course_agent_settings_course_fk" FOREIGN KEY ("community_id","course_id") REFERENCES "public"."courses"("community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_delegations" ADD CONSTRAINT "course_delegations_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_delegations" ADD CONSTRAINT "course_delegations_human_id_users_id_fk" FOREIGN KEY ("human_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_delegations" ADD CONSTRAINT "course_delegations_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_delegations" ADD CONSTRAINT "course_delegations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_delegations" ADD CONSTRAINT "course_delegations_course_fk" FOREIGN KEY ("community_id","course_id") REFERENCES "public"."courses"("community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_submissions_run_unique" ON "agent_submissions" USING btree ("community_id","agent_id","run_id","task_id");--> statement-breakpoint
CREATE INDEX "agent_submissions_community_course_idx" ON "agent_submissions" USING btree ("community_id","course_id","lesson_id","task_id");--> statement-breakpoint
CREATE INDEX "agent_submissions_community_human_idx" ON "agent_submissions" USING btree ("community_id","human_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_submissions_agent_id_idx" ON "agent_submissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_submissions_human_id_idx" ON "agent_submissions" USING btree ("human_id");--> statement-breakpoint
CREATE INDEX "agent_submissions_delegation_id_idx" ON "agent_submissions" USING btree ("delegation_id") WHERE "agent_submissions"."delegation_id" is not null;--> statement-breakpoint
CREATE INDEX "course_agent_settings_community_idx" ON "course_agent_settings" USING btree ("community_id","allow_agent_access");--> statement-breakpoint
CREATE INDEX "course_agent_settings_updated_by_idx" ON "course_agent_settings" USING btree ("updated_by") WHERE "course_agent_settings"."updated_by" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_delegations_live_unique" ON "course_delegations" USING btree ("community_id","course_id","agent_id") WHERE "course_delegations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "course_delegations_community_human_idx" ON "course_delegations" USING btree ("community_id","human_id","granted_at");--> statement-breakpoint
CREATE INDEX "course_delegations_community_agent_idx" ON "course_delegations" USING btree ("community_id","agent_id");--> statement-breakpoint
CREATE INDEX "course_delegations_community_course_idx" ON "course_delegations" USING btree ("community_id","course_id");--> statement-breakpoint
CREATE INDEX "course_delegations_expiry_idx" ON "course_delegations" USING btree ("expires_at") WHERE "course_delegations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "course_delegations_human_id_idx" ON "course_delegations" USING btree ("human_id");--> statement-breakpoint
CREATE INDEX "course_delegations_agent_id_idx" ON "course_delegations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "course_delegations_revoked_by_idx" ON "course_delegations" USING btree ("revoked_by") WHERE "course_delegations"."revoked_by" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request', 'course_delegation'));--> statement-breakpoint
CREATE POLICY "agent_submissions_tenant_isolation" ON "agent_submissions" AS PERMISSIVE FOR ALL TO public USING ("agent_submissions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("agent_submissions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "course_agent_settings_tenant_isolation" ON "course_agent_settings" AS PERMISSIVE FOR ALL TO public USING ("course_agent_settings"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid or coalesce(current_setting('app.delegation_jobs', true), '') = 'on') WITH CHECK ("course_agent_settings"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "course_delegations_tenant_isolation" ON "course_delegations" AS PERMISSIVE FOR ALL TO public USING ("course_delegations"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid or coalesce(current_setting('app.delegation_jobs', true), '') = 'on') WITH CHECK ("course_delegations"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid or coalesce(current_setting('app.delegation_jobs', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "agent_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_agent_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_delegations" FORCE ROW LEVEL SECURITY;
