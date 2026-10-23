CREATE TYPE "public"."platform_billing_issue_kind" AS ENUM('stripe_amount_mismatch', 'ledger_amount_mismatch', 'provider_total_mismatch', 'stripe_invoice_missing');--> statement-breakpoint
CREATE TYPE "public"."platform_invoice_collection" AS ENUM('charge_automatically', 'send_invoice');--> statement-breakpoint
CREATE TYPE "public"."platform_invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TABLE "platform_billing_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"billing_email" "citext",
	"payment_method_id" text,
	"payment_method_label" text,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_billing_accounts_community_unique" UNIQUE("community_id"),
	CONSTRAINT "platform_billing_accounts_label_length" CHECK (char_length("platform_billing_accounts"."payment_method_label") <= 80)
);
--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_billing_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"invoice_id" uuid,
	"kind" "platform_billing_issue_kind" NOT NULL,
	"currency" char(3) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"expected_minor" bigint,
	"actual_minor" bigint,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_billing_issues_currency_format" CHECK ("platform_billing_issues"."currency" ~ '^[a-z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "platform_billing_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoice_lines_entry_unique" UNIQUE("ledger_entry_id")
);
--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount_minor" bigint NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" "platform_invoice_status" DEFAULT 'draft' NOT NULL,
	"collection_method" "platform_invoice_collection" NOT NULL,
	"stripe_invoice_id" text,
	"invoice_number" text,
	"hosted_invoice_url" text,
	"due_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"owner_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoices_period_unique" UNIQUE("community_id","currency","period_start"),
	CONSTRAINT "platform_invoices_currency_format" CHECK ("platform_invoices"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "platform_invoices_amount_positive" CHECK ("platform_invoices"."amount_minor" > 0),
	CONSTRAINT "platform_invoices_paid_range" CHECK ("platform_invoices"."amount_paid_minor" >= 0),
	CONSTRAINT "platform_invoices_period_order" CHECK ("platform_invoices"."period_start" < "platform_invoices"."period_end")
);
--> statement-breakpoint
ALTER TABLE "platform_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" ADD CONSTRAINT "platform_billing_accounts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_billing_issues" ADD CONSTRAINT "platform_billing_issues_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_billing_issues" ADD CONSTRAINT "platform_billing_issues_invoice_id_platform_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."platform_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_invoice_id_platform_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."platform_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_ledger_entry_id_fee_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."fee_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_billing_account_id_platform_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."platform_billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_accounts_customer_unique" ON "platform_billing_accounts" USING btree ("stripe_customer_id") WHERE "platform_billing_accounts"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_issues_one_open" ON "platform_billing_issues" USING btree ("community_id","currency","period_start","kind") WHERE "platform_billing_issues"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "platform_billing_issues_community_detected_idx" ON "platform_billing_issues" USING btree ("community_id","detected_at");--> statement-breakpoint
CREATE INDEX "platform_billing_issues_invoice_idx" ON "platform_billing_issues" USING btree ("invoice_id") WHERE "platform_billing_issues"."invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "platform_invoice_lines_community_invoice_idx" ON "platform_invoice_lines" USING btree ("community_id","invoice_id");--> statement-breakpoint
CREATE INDEX "platform_invoice_lines_invoice_idx" ON "platform_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_stripe_unique" ON "platform_invoices" USING btree ("stripe_invoice_id") WHERE "platform_invoices"."stripe_invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "platform_invoices_community_period_idx" ON "platform_invoices" USING btree ("community_id","period_start");--> statement-breakpoint
CREATE INDEX "platform_invoices_account_idx" ON "platform_invoices" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX "platform_invoices_open_idx" ON "platform_invoices" USING btree ("status") WHERE "platform_invoices"."status" in ('draft', 'open');--> statement-breakpoint
CREATE POLICY "fee_ledger_entries_billing_read" ON "fee_ledger_entries" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_billing_accounts_read" ON "platform_billing_accounts" AS PERMISSIVE FOR SELECT TO public USING (("platform_billing_accounts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') or coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_billing_accounts_write" ON "platform_billing_accounts" AS PERMISSIVE FOR ALL TO public USING ("platform_billing_accounts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and (coalesce(current_setting('app.platform_billing', true), '') = 'on' or coalesce(current_setting('app.payments_manager', true), '') = 'on')) WITH CHECK ("platform_billing_accounts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and (coalesce(current_setting('app.platform_billing', true), '') = 'on' or coalesce(current_setting('app.payments_manager', true), '') = 'on'));--> statement-breakpoint
CREATE POLICY "platform_billing_issues_read" ON "platform_billing_issues" AS PERMISSIVE FOR SELECT TO public USING (("platform_billing_issues"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') or coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_billing_issues_write" ON "platform_billing_issues" AS PERMISSIVE FOR ALL TO public USING ("platform_billing_issues"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on') WITH CHECK ("platform_billing_issues"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoice_lines_read" ON "platform_invoice_lines" AS PERMISSIVE FOR SELECT TO public USING (("platform_invoice_lines"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') or coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoice_lines_write" ON "platform_invoice_lines" AS PERMISSIVE FOR ALL TO public USING ("platform_invoice_lines"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on') WITH CHECK ("platform_invoice_lines"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoices_read" ON "platform_invoices" AS PERMISSIVE FOR SELECT TO public USING (("platform_invoices"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') or coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "platform_invoices_write" ON "platform_invoices" AS PERMISSIVE FOR ALL TO public USING ("platform_invoices"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on') WITH CHECK ("platform_invoices"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.platform_billing', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "platform_billing_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_billing_issues" FORCE ROW LEVEL SECURITY;
