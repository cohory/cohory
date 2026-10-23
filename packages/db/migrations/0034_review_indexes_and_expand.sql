-- CHECK constraints on existing tables are added NOT VALID so the migration takes no validating
-- scan under ACCESS EXCLUSIVE. A later migration validates them.
CREATE TYPE "public"."email_log_status" AS ENUM('sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."email_suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual', 'opt_out');--> statement-breakpoint
CREATE TYPE "public"."email_suppression_source" AS ENUM('smtp', 'webhook', 'operator', 'member');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'report';--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'event';--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'api_token';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'member_joined';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'report_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'event_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'event_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'paid_member_joined';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'paid_member_canceled';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'member_payment_failed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'token_expiring';--> statement-breakpoint
CREATE TABLE "pending_join_answers" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_join_answers_pkey" PRIMARY KEY("community_id","user_id"),
	CONSTRAINT "pending_join_answers_answers_limit" CHECK (jsonb_typeof("pending_join_answers"."answers") = 'array' and jsonb_array_length("pending_join_answers"."answers") <= 3)
);
--> statement-breakpoint
ALTER TABLE "pending_join_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_join_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_headers" jsonb NOT NULL,
	"request_body" text NOT NULL,
	"response_status" integer,
	"response_body_excerpt" text,
	"error_code" text,
	"duration_ms" integer,
	CONSTRAINT "webhook_delivery_attempts_excerpt_length" CHECK (char_length("webhook_delivery_attempts"."response_body_excerpt") <= 2048),
	CONSTRAINT "webhook_delivery_attempts_error_length" CHECK (char_length("webhook_delivery_attempts"."error_code") <= 200),
	CONSTRAINT "webhook_delivery_attempts_duration_nonnegative" CHECK ("webhook_delivery_attempts"."duration_ms" is null or "webhook_delivery_attempts"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"status" "email_log_status" NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_log_recipient_hash_format" CHECK ("email_log"."recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_log_template_length" CHECK (char_length("email_log"."template") between 1 and 64),
	CONSTRAINT "email_log_error_code_length" CHECK ("email_log"."error_code" is null or char_length("email_log"."error_code") <= 64)
);
--> statement-breakpoint
ALTER TABLE "email_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"address_hash" text NOT NULL,
	"community_id" uuid,
	"reason" "email_suppression_reason" NOT NULL,
	"source" "email_suppression_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_address_hash_format" CHECK ("email_suppressions"."address_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
DROP INDEX "webhook_deliveries_endpoint_idx";--> statement-breakpoint
ALTER TABLE "membership_plans" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "what_you_get" jsonb;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "host_bio" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "host_credential" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "faq" jsonb;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "setup_checklist_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "setup_import_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "about_previewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "invite_link_copied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "test_checkout_succeeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "purge_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "weekly_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "last_weekly_digest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invite_links" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_used_via" "audit_via";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expiry_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "previous_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_join_answers" ADD CONSTRAINT "pending_join_answers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_join_answers" ADD CONSTRAINT "pending_join_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_join_answers_user_idx" ON "pending_join_answers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_idx" ON "webhook_delivery_attempts" USING btree ("community_id","delivery_id","attempted_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_id_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "email_log_recipient_created_idx" ON "email_log" USING btree ("recipient_hash","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_instance_unique" ON "email_suppressions" USING btree ("address_hash") WHERE "email_suppressions"."community_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_community_unique" ON "email_suppressions" USING btree ("community_id","address_hash") WHERE "email_suppressions"."community_id" is not null;--> statement-breakpoint
CREATE INDEX "email_suppressions_address_idx" ON "email_suppressions" USING btree ("address_hash");--> statement-breakpoint
CREATE INDEX "communities_purge_queue_idx" ON "communities" USING btree ("purge_attempted_at" NULLS FIRST,"deleted_at","id") WHERE "communities"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "memberships_community_directory_idx" ON "memberships" USING btree ("community_id",coalesce("joined_at", "created_at") desc,"id" DESC NULLS FIRST) WHERE "memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "comments_post_id_idx" ON "comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_post_id_idx" ON "notifications" USING btree ("post_id") WHERE "notifications"."post_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_actor_id_idx" ON "notifications" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "points_ledger_admin_reset_idx" ON "points_ledger" USING btree ("community_id","user_id","occurred_at" DESC NULLS LAST) WHERE "points_ledger"."reason" = 'admin_reset';--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id") WHERE "audit_log"."actor_id" is not null;--> statement-breakpoint
CREATE INDEX "invite_links_created_by_idx" ON "invite_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "fee_ledger_entries_payment_id_idx" ON "fee_ledger_entries" USING btree ("payment_id") WHERE "fee_ledger_entries"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "membership_plans_connection_id_idx" ON "membership_plans" USING btree ("connection_id") WHERE "membership_plans"."connection_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_subscription_id_idx" ON "payments" USING btree ("subscription_id") WHERE "payments"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "provider_events_connection_id_idx" ON "provider_events" USING btree ("connection_id") WHERE "provider_events"."connection_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_connection_id_idx" ON "subscriptions" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions" USING btree ("plan_id") WHERE "subscriptions"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("community_id","endpoint_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_what_you_get_limit" CHECK ("communities"."what_you_get" is null or (jsonb_typeof("communities"."what_you_get") = 'array' and jsonb_array_length("communities"."what_you_get") <= 6)) NOT VALID;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_faq_limit" CHECK ("communities"."faq" is null or (jsonb_typeof("communities"."faq") = 'array' and jsonb_array_length("communities"."faq") <= 8)) NOT VALID;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_host_bio_length" CHECK (char_length("communities"."host_bio") <= 600) NOT VALID;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_host_credential_length" CHECK (char_length("communities"."host_credential") <= 120) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request', 'course_delegation', 'review', 'community', 'report', 'event', 'api_token')) NOT VALID;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_source_type_known" CHECK ("points_ledger"."source_type" is null or "points_ledger"."source_type" in ('reaction', 'points_reset', 'points_reset_member')) NOT VALID;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_label_length" CHECK ("invite_links"."label" is null or char_length("invite_links"."label") between 1 and 60) NOT VALID;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_previous_secret_expiry" CHECK (("webhook_endpoints"."previous_secret_ciphertext" is null) = ("webhook_endpoints"."previous_secret_expires_at" is null)) NOT VALID;--> statement-breakpoint
CREATE POLICY "notifications_community_purge_scan" ON "notifications" AS PERMISSIVE FOR SELECT TO public USING ("notifications"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "notifications_community_purge" ON "notifications" AS PERMISSIVE FOR DELETE TO public USING ("notifications"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "points_ledger_community_purge" ON "points_ledger" AS PERMISSIVE FOR DELETE TO public USING ("points_ledger"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "pending_join_answers_own_rows" ON "pending_join_answers" AS PERMISSIVE FOR ALL TO public USING ("pending_join_answers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "pending_join_answers"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("pending_join_answers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "pending_join_answers"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pending_join_answers_activation" ON "pending_join_answers" AS PERMISSIVE FOR ALL TO public USING ("pending_join_answers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_webhook', true), '') = 'on') WITH CHECK ("pending_join_answers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "pending_join_answers_account_purge" ON "pending_join_answers" AS PERMISSIVE FOR ALL TO public USING ("pending_join_answers"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("pending_join_answers"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "webhook_delivery_attempts_access" ON "webhook_delivery_attempts" AS PERMISSIVE FOR ALL TO public USING (("webhook_delivery_attempts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on') WITH CHECK (("webhook_delivery_attempts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "email_log_delivery" ON "email_log" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.email_delivery', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.email_delivery', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "email_suppressions_delivery" ON "email_suppressions" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.email_delivery', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.email_delivery', true), '') = 'on');