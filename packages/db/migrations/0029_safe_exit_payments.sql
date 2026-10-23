CREATE TYPE "public"."payment_exit_choice" AS ENUM('stop_at_period_end', 'keep_billing', 'take_members', 'wind_down', 'cancel_now');--> statement-breakpoint
CREATE TYPE "public"."payment_exit_kind" AS ENUM('archive', 'disconnect', 'delete');--> statement-breakpoint
CREATE TYPE "public"."payment_exit_status" AS ENUM('pending', 'running', 'failed', 'done');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'community';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'paid_membership_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'ownership_transferred';--> statement-breakpoint
ALTER TYPE "public"."payment_connection_status" ADD VALUE 'disconnecting';--> statement-breakpoint
CREATE TABLE "payment_exit_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"connection_id" uuid,
	"kind" "payment_exit_kind" NOT NULL,
	"choice" "payment_exit_choice" NOT NULL,
	"include_linked" boolean DEFAULT true NOT NULL,
	"status" "payment_exit_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"target_count" integer DEFAULT 0 NOT NULL,
	"done_count" integer DEFAULT 0 NOT NULL,
	"failed_subscription_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"portal_login_url" text,
	"requested_by" uuid,
	"manual_cancellation_confirmed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_exit_runs_counts" CHECK ("payment_exit_runs"."attempts" >= 0 and "payment_exit_runs"."target_count" >= 0 and "payment_exit_runs"."done_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_exit_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" DROP CONSTRAINT "fee_ledger_entries_community_id_communities_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_community_id_communities_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" DROP CONSTRAINT "platform_billing_accounts_community_id_communities_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" DROP CONSTRAINT "platform_invoice_lines_community_id_communities_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_invoices" DROP CONSTRAINT "platform_invoices_community_id_communities_id_fk";
--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ALTER COLUMN "community_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "community_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ALTER COLUMN "community_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ALTER COLUMN "community_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ALTER COLUMN "community_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD COLUMN "former_community_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD COLUMN "former_community_name" text;--> statement-breakpoint
ALTER TABLE "payment_connections" ADD COLUMN "accepted_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "former_community_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "former_community_name" text;--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD COLUMN "former_community_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD COLUMN "former_community_name" text;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD COLUMN "former_community_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD COLUMN "former_community_name" text;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "former_community_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "former_community_name" text;--> statement-breakpoint
ALTER TABLE "payment_exit_runs" ADD CONSTRAINT "payment_exit_runs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_exit_runs" ADD CONSTRAINT "payment_exit_runs_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_exit_runs" ADD CONSTRAINT "payment_exit_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_exit_runs_community_created_idx" ON "payment_exit_runs" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_exit_runs_one_unfinished" ON "payment_exit_runs" USING btree ("community_id") WHERE "payment_exit_runs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "payment_exit_runs_connection_idx" ON "payment_exit_runs" USING btree ("connection_id") WHERE "payment_exit_runs"."connection_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_exit_runs_requested_by_idx" ON "payment_exit_runs" USING btree ("requested_by") WHERE "payment_exit_runs"."requested_by" is not null;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_accepted_owner_id_users_id_fk" FOREIGN KEY ("accepted_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD CONSTRAINT "platform_billing_accounts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_connections_accepted_owner_idx" ON "payment_connections" USING btree ("accepted_owner_id") WHERE "payment_connections"."accepted_owner_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request', 'course_delegation', 'review', 'community'));--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_community_or_former" CHECK ("fee_ledger_entries"."community_id" is not null or "fee_ledger_entries"."former_community_id" is not null);--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_former_matches" CHECK ("fee_ledger_entries"."former_community_id" is null or "fee_ledger_entries"."community_id" is null or "fee_ledger_entries"."former_community_id" = "fee_ledger_entries"."community_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_community_or_former" CHECK ("payments"."community_id" is not null or "payments"."former_community_id" is not null);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_former_matches" CHECK ("payments"."former_community_id" is null or "payments"."community_id" is null or "payments"."former_community_id" = "payments"."community_id");--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD CONSTRAINT "platform_billing_accounts_community_or_former" CHECK ("platform_billing_accounts"."community_id" is not null or "platform_billing_accounts"."former_community_id" is not null);--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD CONSTRAINT "platform_billing_accounts_former_matches" CHECK ("platform_billing_accounts"."former_community_id" is null or "platform_billing_accounts"."community_id" is null or "platform_billing_accounts"."former_community_id" = "platform_billing_accounts"."community_id");--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_community_or_former" CHECK ("platform_invoice_lines"."community_id" is not null or "platform_invoice_lines"."former_community_id" is not null);--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_former_matches" CHECK ("platform_invoice_lines"."former_community_id" is null or "platform_invoice_lines"."community_id" is null or "platform_invoice_lines"."former_community_id" = "platform_invoice_lines"."community_id");--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_community_or_former" CHECK ("platform_invoices"."community_id" is not null or "platform_invoices"."former_community_id" is not null);--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_former_matches" CHECK ("platform_invoices"."former_community_id" is null or "platform_invoices"."community_id" is null or "platform_invoices"."former_community_id" = "platform_invoices"."community_id");--> statement-breakpoint
CREATE POLICY "fee_ledger_entries_detach" ON "fee_ledger_entries" AS PERMISSIVE FOR UPDATE TO public USING ("fee_ledger_entries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on') WITH CHECK ("fee_ledger_entries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payments_detach" ON "payments" AS PERMISSIVE FOR UPDATE TO public USING ("payments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on') WITH CHECK ("payments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "subscriptions_own_rows" ON "subscriptions" AS PERMISSIVE FOR SELECT TO public USING ("subscriptions"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_exit_jobs" ON "subscriptions" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_billing_accounts_detach" ON "platform_billing_accounts" AS PERMISSIVE FOR UPDATE TO public USING ("platform_billing_accounts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on') WITH CHECK ("platform_billing_accounts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoice_lines_detach" ON "platform_invoice_lines" AS PERMISSIVE FOR UPDATE TO public USING ("platform_invoice_lines"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on') WITH CHECK ("platform_invoice_lines"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoices_detach" ON "platform_invoices" AS PERMISSIVE FOR UPDATE TO public USING ("platform_invoices"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on') WITH CHECK ("platform_invoices"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_detach', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_exit_runs_manager_read" ON "payment_exit_runs" AS PERMISSIVE FOR SELECT TO public USING ("payment_exit_runs"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_exit_runs_manage" ON "payment_exit_runs" AS PERMISSIVE FOR ALL TO public USING ("payment_exit_runs"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("payment_exit_runs"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_exit_runs_job" ON "payment_exit_runs" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.payments_webhook', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "payment_connections" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "payment_connections" SET "accepted_owner_id" = "memberships"."user_id" FROM "memberships" WHERE "memberships"."community_id" = "payment_connections"."community_id" AND "memberships"."role" = 'owner' AND "memberships"."status" = 'active' AND "payment_connections"."accepted_owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_exit_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION "financial_record_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot_keys text[] := array['community_id', 'former_community_id', 'former_community_name', 'updated_at'];
BEGIN
  IF to_jsonb(NEW) ? 'subscription_id' AND to_jsonb(NEW)->>'subscription_id' IS NULL THEN
    snapshot_keys := array_append(snapshot_keys, 'subscription_id');
  END IF;
  IF (OLD.former_community_id IS NOT NULL AND NEW.former_community_id IS DISTINCT FROM OLD.former_community_id)
    OR (OLD.former_community_name IS NOT NULL AND NEW.former_community_name IS DISTINCT FROM OLD.former_community_name) THEN
    RAISE EXCEPTION 'the community snapshot on % cannot change once written', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.community_id IS NOT NULL AND NEW.community_id IS DISTINCT FROM OLD.community_id THEN
    RAISE EXCEPTION 'rows in % cannot move to another community', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_TABLE_NAME = 'fee_ledger_entries'
      OR OLD.community_id IS NULL
      OR NEW.community_id IS DISTINCT FROM OLD.community_id
      OR NEW.former_community_id IS DISTINCT FROM OLD.former_community_id
      OR NEW.former_community_name IS DISTINCT FROM OLD.former_community_name
      OR coalesce(current_setting('app.payments_detach', true), '') = 'on')
    AND (to_jsonb(NEW) - snapshot_keys) IS DISTINCT FROM (to_jsonb(OLD) - snapshot_keys) THEN
    RAISE EXCEPTION 'only the community snapshot on % can change here', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payments_detach_guard" BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION "financial_record_guard"();--> statement-breakpoint
CREATE TRIGGER "fee_ledger_entries_detach_guard" BEFORE UPDATE ON "fee_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "financial_record_guard"();--> statement-breakpoint
CREATE TRIGGER "platform_billing_accounts_detach_guard" BEFORE UPDATE ON "platform_billing_accounts" FOR EACH ROW EXECUTE FUNCTION "financial_record_guard"();--> statement-breakpoint
CREATE TRIGGER "platform_invoices_detach_guard" BEFORE UPDATE ON "platform_invoices" FOR EACH ROW EXECUTE FUNCTION "financial_record_guard"();--> statement-breakpoint
CREATE TRIGGER "platform_invoice_lines_detach_guard" BEFORE UPDATE ON "platform_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "financial_record_guard"();
