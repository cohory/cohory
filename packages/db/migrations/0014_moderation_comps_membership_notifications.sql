CREATE TYPE "public"."comp_end_reason" AS ENUM('revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'sexual', 'violence', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'dismissed', 'content_removed', 'member_banned');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'membership_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request_declined';--> statement-breakpoint
CREATE TABLE "comped_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"note" text,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" "comp_end_reason",
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comped_memberships_note_length" CHECK (char_length("comped_memberships"."note") <= 200),
	CONSTRAINT "comped_memberships_end_consistent" CHECK (("comped_memberships"."ended_at" is null) = ("comped_memberships"."end_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "comped_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid,
	"reporter_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_note_length" CHECK (char_length("content_reports"."note") <= 500),
	CONSTRAINT "content_reports_resolution" CHECK (("content_reports"."status" = 'open') = ("content_reports"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "content_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comped_memberships" ADD CONSTRAINT "comped_memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comped_memberships" ADD CONSTRAINT "comped_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comped_memberships" ADD CONSTRAINT "comped_memberships_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comped_memberships" ADD CONSTRAINT "comped_memberships_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comped_memberships_one_open" ON "comped_memberships" USING btree ("community_id","user_id") WHERE "comped_memberships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "comped_memberships_community_created_idx" ON "comped_memberships" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "comped_memberships_expiry_idx" ON "comped_memberships" USING btree ("expires_at") WHERE "comped_memberships"."ended_at" is null and "comped_memberships"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "comped_memberships_user_idx" ON "comped_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comped_memberships_granted_by_idx" ON "comped_memberships" USING btree ("granted_by") WHERE "comped_memberships"."granted_by" is not null;--> statement-breakpoint
CREATE INDEX "comped_memberships_ended_by_idx" ON "comped_memberships" USING btree ("ended_by") WHERE "comped_memberships"."ended_by" is not null;--> statement-breakpoint
CREATE INDEX "content_reports_queue_idx" ON "content_reports" USING btree ("community_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_one_open_post" ON "content_reports" USING btree ("community_id","post_id","reporter_id") WHERE "content_reports"."comment_id" is null and "content_reports"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_one_open_comment" ON "content_reports" USING btree ("community_id","comment_id","reporter_id") WHERE "content_reports"."comment_id" is not null and "content_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "content_reports_post_idx" ON "content_reports" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "content_reports_comment_idx" ON "content_reports" USING btree ("comment_id") WHERE "content_reports"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "content_reports_resolved_by_idx" ON "content_reports" USING btree ("resolved_by") WHERE "content_reports"."resolved_by" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text = 'membership_request');--> statement-breakpoint
CREATE POLICY "comped_memberships_read" ON "comped_memberships" AS PERMISSIVE FOR SELECT TO public USING ("comped_memberships"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and ("comped_memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or coalesce(current_setting('app.payments_manager', true), '') = 'on'));--> statement-breakpoint
CREATE POLICY "comped_memberships_manage" ON "comped_memberships" AS PERMISSIVE FOR ALL TO public USING ("comped_memberships"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("comped_memberships"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "comped_memberships_expiry_job" ON "comped_memberships" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.payments_webhook', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "content_reports_manage" ON "content_reports" AS PERMISSIVE FOR ALL TO public USING ("content_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on') WITH CHECK ("content_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "content_reports_own_read" ON "content_reports" AS PERMISSIVE FOR SELECT TO public USING ("content_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "content_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "content_reports_own_insert" ON "content_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("content_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "content_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid and "content_reports"."status" = 'open');--> statement-breakpoint
ALTER TABLE "comped_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_reports" FORCE ROW LEVEL SECURITY;