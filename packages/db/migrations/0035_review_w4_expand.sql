-- Hand edits after drizzle-kit generate. The migrator applies every pending migration in one
-- transaction, so each lock is held until commit. Statements run in order of lock strength:
-- new tables, index builds on other tables, VALIDATE (SHARE UPDATE EXCLUSIVE), the posts index
-- builds (SHARE: reads go on, writes wait), then every statement that takes ACCESS EXCLUSIVE on
-- an existing table, ending with the drops of the replaced indexes. Also added by hand: FORCE
-- row level security on the new tenant tables, the points_ledger source type cleanup with its
-- copy in points_ledger_source_cleanup_0035, and validated re-adds of the 0034 checks on
-- communities.
CREATE TYPE "public"."migration_email_choice" AS ENUM('now', 'later', 'never');--> statement-breakpoint
CREATE TYPE "public"."subscriber_move_source" AS ENUM('skool', 'circle', 'archive', 'csv', 'manual');--> statement-breakpoint
CREATE TYPE "public"."subscriber_move_status" AS ENUM('pending', 'resubscribed', 'expired');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'comment_on_followed_post';--> statement-breakpoint
ALTER TYPE "public"."points_reason" ADD VALUE 'lesson_completed';--> statement-breakpoint
ALTER TYPE "public"."points_reason" ADD VALUE 'event_attended';--> statement-breakpoint
CREATE TABLE "post_follows" (
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_follows_pkey" PRIMARY KEY("post_id","user_id")
);--> statement-breakpoint
ALTER TABLE "post_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "points_ledger_source_cleanup_0035" (
	"ledger_id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"cleaned_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "points_ledger_source_cleanup_0035" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_terms_acceptances" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_terms_acceptances_pkey" PRIMARY KEY("community_id","user_id","version"),
	CONSTRAINT "creator_terms_acceptances_version_length" CHECK (char_length("creator_terms_acceptances"."version") between 1 and 64)
);--> statement-breakpoint
ALTER TABLE "creator_terms_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriber_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"was_paying" boolean DEFAULT false NOT NULL,
	"source" "subscriber_move_source" NOT NULL,
	"free_until" timestamp with time zone,
	"status" "subscriber_move_status" DEFAULT 'pending' NOT NULL,
	"job_id" uuid,
	"subscription_id" uuid,
	"resubscribed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_moves_community_email_unique" UNIQUE("community_id","email"),
	CONSTRAINT "subscriber_moves_resubscribed" CHECK (("subscriber_moves"."status" = 'resubscribed') = ("subscriber_moves"."resubscribed_at" is not null))
);--> statement-breakpoint
ALTER TABLE "subscriber_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_terms_acceptances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriber_moves" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "post_follows_community_user_idx" ON "post_follows" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "post_follows_user_id_idx" ON "post_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creator_terms_acceptances_user_idx" ON "creator_terms_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriber_moves_community_status_idx" ON "subscriber_moves" USING btree ("community_id","status","created_at");--> statement-breakpoint
CREATE INDEX "subscriber_moves_expiry_idx" ON "subscriber_moves" USING btree ("free_until") WHERE "subscriber_moves"."status" = 'pending' and "subscriber_moves"."free_until" is not null;--> statement-breakpoint
CREATE INDEX "subscriber_moves_job_idx" ON "subscriber_moves" USING btree ("job_id") WHERE "subscriber_moves"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriber_moves_subscription_idx" ON "subscriber_moves" USING btree ("subscription_id") WHERE "subscriber_moves"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriber_moves_created_by_idx" ON "subscriber_moves" USING btree ("created_by") WHERE "subscriber_moves"."created_by" is not null;--> statement-breakpoint
CREATE POLICY "post_follows_own_rows" ON "post_follows" AS PERMISSIVE FOR ALL TO public USING ("post_follows"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "post_follows"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("post_follows"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "post_follows"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "post_follows_notification_scan" ON "post_follows" AS PERMISSIVE FOR SELECT TO public USING ("post_follows"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.notification_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "post_follows_account_purge" ON "post_follows" AS PERMISSIVE FOR ALL TO public USING ("post_follows"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("post_follows"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "creator_terms_acceptances_read" ON "creator_terms_acceptances" AS PERMISSIVE FOR SELECT TO public USING ("creator_terms_acceptances"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "creator_terms_acceptances_accept" ON "creator_terms_acceptances" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("creator_terms_acceptances"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "creator_terms_acceptances"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "subscriber_moves_manage" ON "subscriber_moves" AS PERMISSIVE FOR ALL TO public USING ("subscriber_moves"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("subscriber_moves"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "subscriber_moves_payments_job" ON "subscriber_moves" AS PERMISSIVE FOR ALL TO public USING ("subscriber_moves"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_webhook', true), '') = 'on') WITH CHECK ("subscriber_moves"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE INDEX "member_stats_leaderboard_v2_idx" ON "member_stats" USING btree ("community_id","points_total" DESC NULLS FIRST,"updated_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_source_reason_v2_unique" ON "points_ledger" USING btree ("source_type","source_id","reason") WHERE "points_ledger"."source_type" not in ('lesson', 'event_occurrence');--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_learning_unique" ON "points_ledger" USING btree ("community_id","user_id","source_type","source_id","reason") WHERE "points_ledger"."source_type" in ('lesson', 'event_occurrence');--> statement-breakpoint
CREATE INDEX "provider_events_unprocessed_idx" ON "provider_events" USING btree ("received_at") WHERE "provider_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "membership_requests_queue_v2_idx" ON "membership_requests" USING btree ("community_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "migration_jobs_community_created_v2_idx" ON "migration_jobs" USING btree ("community_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "approval_requests_community_state_v2_idx" ON "approval_requests" USING btree ("community_id","state","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "reviews_community_created_v2_idx" ON "reviews" USING btree ("community_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_post_subject";--> statement-breakpoint
ALTER TABLE "invite_links" VALIDATE CONSTRAINT "invite_links_label_length";--> statement-breakpoint
ALTER TABLE "webhook_endpoints" VALIDATE CONSTRAINT "webhook_endpoints_previous_secret_expiry";--> statement-breakpoint
CREATE UNIQUE INDEX "posts_community_id_unique" ON "posts" USING btree ("community_id","id");--> statement-breakpoint
CREATE INDEX "posts_feed_v2_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_activity_v2_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,"last_activity_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_top_v2_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,("like_count" + 2 * "comment_count") desc,"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_category_feed_v2_idx" ON "posts" USING btree ("community_id","category_id","pinned_at" DESC NULLS LAST,"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "post_follows" ADD CONSTRAINT "post_follows_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_follows" ADD CONSTRAINT "post_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_follows" ADD CONSTRAINT "post_follows_post_fk" FOREIGN KEY ("community_id","post_id") REFERENCES "public"."posts"("community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_terms_acceptances" ADD CONSTRAINT "creator_terms_acceptances_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_terms_acceptances" ADD CONSTRAINT "creator_terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_moves" ADD CONSTRAINT "subscriber_moves_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_moves" ADD CONSTRAINT "subscriber_moves_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_moves" ADD CONSTRAINT "subscriber_moves_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_moves" ADD CONSTRAINT "subscriber_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "refund_policy" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "points_for_lessons" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "points_for_events" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "member_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "member_email_sent_by" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "last_feed_visit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "onboarding_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "welcome_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "required_level" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "email_choice" "migration_email_choice";--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "emails_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_member_email_sent_by_users_id_fk" FOREIGN KEY ("member_email_sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communities_member_email_sent_by_idx" ON "communities" USING btree ("member_email_sent_by") WHERE "communities"."member_email_sent_by" is not null;--> statement-breakpoint
CREATE INDEX "migration_jobs_expiry_idx" ON "migration_jobs" USING btree ("expires_at") WHERE "migration_jobs"."deleted_at" is null and "migration_jobs"."expires_at" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_terms_accepted" CHECK (("users"."terms_version" is null) = ("users"."terms_accepted_at" is null) and ("users"."terms_version" is null or char_length("users"."terms_version") between 1 and 64));--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_refund_policy_length" CHECK (char_length("communities"."refund_policy") between 1 and 280);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_member_email_sent" CHECK ("communities"."member_email_sent_by" is null or "communities"."member_email_sent_at" is not null);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_required_level_range" CHECK ("courses"."required_level" between 1 and 9);--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "communities_what_you_get_limit";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_what_you_get_limit" CHECK ("communities"."what_you_get" is null or (jsonb_typeof("communities"."what_you_get") = 'array' and jsonb_array_length("communities"."what_you_get") <= 6));--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "communities_faq_limit";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_faq_limit" CHECK ("communities"."faq" is null or (jsonb_typeof("communities"."faq") = 'array' and jsonb_array_length("communities"."faq") <= 8));--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "communities_host_bio_length";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_host_bio_length" CHECK (char_length("communities"."host_bio") <= 600);--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "communities_host_credential_length";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_host_credential_length" CHECK (char_length("communities"."host_credential") <= 120);--> statement-breakpoint
ALTER TABLE "points_ledger" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "points_ledger_source_cleanup_0035" ("ledger_id", "community_id", "source_type", "source_id") SELECT "id", "community_id", "source_type", "source_id" FROM "points_ledger" WHERE "source_type" NOT IN ('reaction', 'points_reset', 'points_reset_member', 'lesson', 'event_occurrence');--> statement-breakpoint
UPDATE "points_ledger" SET "source_type" = NULL, "source_id" = NULL WHERE "source_type" NOT IN ('reaction', 'points_reset', 'points_reset_member', 'lesson', 'event_occurrence');--> statement-breakpoint
ALTER TABLE "points_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger" DROP CONSTRAINT "points_ledger_source_type_known";--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_source_type_known" CHECK ("points_ledger"."source_type" is null or "points_ledger"."source_type" in ('reaction', 'points_reset', 'points_reset_member', 'lesson', 'event_occurrence'));--> statement-breakpoint
DROP INDEX "posts_feed_idx";--> statement-breakpoint
DROP INDEX "posts_activity_idx";--> statement-breakpoint
DROP INDEX "posts_top_idx";--> statement-breakpoint
DROP INDEX "posts_category_feed_idx";--> statement-breakpoint
DROP INDEX "member_stats_leaderboard_idx";--> statement-breakpoint
DROP INDEX "points_ledger_source_reason_unique";--> statement-breakpoint
DROP INDEX "membership_requests_queue_idx";--> statement-breakpoint
DROP INDEX "migration_jobs_community_created_idx";--> statement-breakpoint
DROP INDEX "approval_requests_community_state_idx";--> statement-breakpoint
DROP INDEX "reviews_community_created_idx";
