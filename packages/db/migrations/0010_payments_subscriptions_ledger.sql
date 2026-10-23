CREATE TYPE "public"."fee_collection_method" AS ENUM('automatic_split', 'periodic_invoice');--> statement-breakpoint
CREATE TYPE "public"."fee_ledger_kind" AS ENUM('fee_accrued', 'fee_collected', 'fee_refunded', 'adjustment', 'invoice_settled');--> statement-breakpoint
CREATE TYPE "public"."payment_connection_status" AS ENUM('onboarding', 'active', 'restricted', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe_connect', 'stripe_own_keys');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."subscription_access_state" AS ENUM('none', 'granted', 'grace', 'revoked');--> statement-breakpoint
CREATE TABLE "fee_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"payment_id" uuid,
	"kind" "fee_ledger_kind" NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"collection_method" "fee_collection_method" NOT NULL,
	"currency" char(3) NOT NULL,
	"base_minor" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"computed_fee_minor" bigint NOT NULL,
	"provider_fee_minor" bigint,
	"external_ref" text,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_ledger_entries_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "fee_ledger_entries_currency_format" CHECK ("fee_ledger_entries"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "fee_ledger_entries_rate_range" CHECK ("fee_ledger_entries"."rate_bps" between 0 and 10000),
	CONSTRAINT "fee_ledger_entries_sign" CHECK (("fee_ledger_entries"."kind" = 'fee_refunded' and "fee_ledger_entries"."computed_fee_minor" <= 0 and coalesce("fee_ledger_entries"."provider_fee_minor", 0) <= 0) or ("fee_ledger_entries"."kind" in ('fee_accrued', 'fee_collected') and "fee_ledger_entries"."computed_fee_minor" >= 0 and coalesce("fee_ledger_entries"."provider_fee_minor", 0) >= 0) or "fee_ledger_entries"."kind" in ('adjustment', 'invoice_settled'))
);
--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"monthly_price_minor" bigint NOT NULL,
	"annual_price_minor" bigint,
	"provider_product_id" text,
	"provider_monthly_price_id" text,
	"provider_annual_price_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_name_length" CHECK (char_length("membership_plans"."name") between 1 and 80),
	CONSTRAINT "membership_plans_currency_format" CHECK ("membership_plans"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "membership_plans_monthly_positive" CHECK ("membership_plans"."monthly_price_minor" > 0),
	CONSTRAINT "membership_plans_annual_positive" CHECK ("membership_plans"."annual_price_minor" is null or "membership_plans"."annual_price_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "membership_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"external_account_id" text,
	"encrypted_secret" text,
	"webhook_secret_encrypted" text,
	"status" "payment_connection_status" NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_connections_own_keys_secret" CHECK ("payment_connections"."provider" <> 'stripe_own_keys' or "payment_connections"."status" = 'disconnected' or ("payment_connections"."encrypted_secret" is not null and "payment_connections"."webhook_secret_encrypted" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_customers_connection_external_unique" UNIQUE("connection_id","external_customer_id")
);
--> statement-breakpoint
ALTER TABLE "payment_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"subscription_id" uuid,
	"external_invoice_id" text NOT NULL,
	"external_payment_intent_id" text,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_external_invoice_unique" UNIQUE("external_invoice_id"),
	CONSTRAINT "payments_currency_format" CHECK ("payments"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "payments_amounts_valid" CHECK ("payments"."amount_minor" >= 0 and "payments"."tax_minor" >= 0 and "payments"."refunded_minor" between 0 and "payments"."amount_minor")
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"external_event_id" text NOT NULL,
	"external_account_id" text,
	"connection_id" uuid,
	"community_id" uuid,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"payload_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "provider_events_provider_event_unique" UNIQUE("provider","external_event_id")
);
--> statement-breakpoint
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"plan_id" uuid,
	"external_subscription_id" text NOT NULL,
	"provider_status" text NOT NULL,
	"access_state" "subscription_access_state" NOT NULL,
	"interval" "plan_interval",
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"ended_at" timestamp with time zone,
	"application_fee_bps" integer NOT NULL,
	"origin" text DEFAULT 'created_by_cohory' NOT NULL,
	"provider_fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_external_unique" UNIQUE("external_subscription_id"),
	CONSTRAINT "subscriptions_fee_bps_range" CHECK ("subscriptions"."application_fee_bps" between 0 and 10000),
	CONSTRAINT "subscriptions_origin_values" CHECK ("subscriptions"."origin" in ('created_by_cohory', 'linked_import'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_payment_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."payment_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_ledger_entries_community_occurred_idx" ON "fee_ledger_entries" USING btree ("community_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_one_active_per_community" ON "membership_plans" USING btree ("community_id") WHERE "membership_plans"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "membership_plans_community_created_idx" ON "membership_plans" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_connections_one_open_per_community" ON "payment_connections" USING btree ("community_id") WHERE "payment_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_connections_open_account_unique" ON "payment_connections" USING btree ("external_account_id") WHERE "payment_connections"."status" <> 'disconnected' and "payment_connections"."external_account_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_customers_community_user_idx" ON "payment_customers" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "payments_community_occurred_idx" ON "payments" USING btree ("community_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payments_community_payment_intent_idx" ON "payments" USING btree ("community_id","external_payment_intent_id");--> statement-breakpoint
CREATE INDEX "provider_events_community_received_idx" ON "provider_events" USING btree ("community_id","received_at");--> statement-breakpoint
CREATE INDEX "subscriptions_community_user_idx" ON "subscriptions" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE POLICY "fee_ledger_entries_manager_read" ON "fee_ledger_entries" AS PERMISSIVE FOR SELECT TO public USING ("fee_ledger_entries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "fee_ledger_entries_append" ON "fee_ledger_entries" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("fee_ledger_entries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "membership_plans_read" ON "membership_plans" AS PERMISSIVE FOR SELECT TO public USING ("membership_plans"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_plans_manage" ON "membership_plans" AS PERMISSIVE FOR ALL TO public USING ("membership_plans"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("membership_plans"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_connections_read" ON "payment_connections" AS PERMISSIVE FOR SELECT TO public USING ("payment_connections"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "payment_connections_manage" ON "payment_connections" AS PERMISSIVE FOR ALL TO public USING ("payment_connections"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("payment_connections"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_connections_webhook_lookup" ON "payment_connections" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payment_customers_read" ON "payment_customers" AS PERMISSIVE FOR SELECT TO public USING ("payment_customers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and ("payment_customers"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or coalesce(current_setting('app.payments_manager', true), '') = 'on'));--> statement-breakpoint
CREATE POLICY "payment_customers_manage" ON "payment_customers" AS PERMISSIVE FOR ALL TO public USING ("payment_customers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("payment_customers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payments_manager_read" ON "payments" AS PERMISSIVE FOR SELECT TO public USING ("payments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "payments_manage" ON "payments" AS PERMISSIVE FOR ALL TO public USING ("payments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("payments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "provider_events_webhook" ON "provider_events" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.payments_webhook', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.payments_webhook', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "subscriptions_read" ON "subscriptions" AS PERMISSIVE FOR SELECT TO public USING ("subscriptions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and ("subscriptions"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or coalesce(current_setting('app.payments_manager', true), '') = 'on'));--> statement-breakpoint
CREATE POLICY "subscriptions_manage" ON "subscriptions" AS PERMISSIVE FOR ALL TO public USING ("subscriptions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("subscriptions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "payment_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_events" FORCE ROW LEVEL SECURITY;