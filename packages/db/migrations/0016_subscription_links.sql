CREATE TYPE "public"."subscription_link_status" AS ENUM('linked', 'invited');--> statement-breakpoint
CREATE TABLE "subscription_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_subscription_id" text NOT NULL,
	"external_customer_id" text NOT NULL,
	"external_price_id" text,
	"email" "citext" NOT NULL,
	"plan_id" uuid,
	"interval" "plan_interval" NOT NULL,
	"status" "subscription_link_status" NOT NULL,
	"user_id" uuid,
	"subscription_id" uuid,
	"application_fee_bps" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_links_external_unique" UNIQUE("external_subscription_id"),
	CONSTRAINT "subscription_links_fee_bps_range" CHECK ("subscription_links"."application_fee_bps" between 0 and 10000),
	CONSTRAINT "subscription_links_linked_at" CHECK (("subscription_links"."status" = 'linked') = ("subscription_links"."linked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "subscription_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_price_id" text;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_connection_id_payment_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."payment_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_links" ADD CONSTRAINT "subscription_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_links_community_created_idx" ON "subscription_links" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_links_community_invited_email_idx" ON "subscription_links" USING btree ("community_id","email") WHERE "subscription_links"."status" = 'invited';--> statement-breakpoint
CREATE INDEX "subscription_links_connection_idx" ON "subscription_links" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "subscription_links_plan_idx" ON "subscription_links" USING btree ("plan_id") WHERE "subscription_links"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "subscription_links_user_idx" ON "subscription_links" USING btree ("user_id") WHERE "subscription_links"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "subscription_links_subscription_idx" ON "subscription_links" USING btree ("subscription_id") WHERE "subscription_links"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "subscription_links_created_by_idx" ON "subscription_links" USING btree ("created_by") WHERE "subscription_links"."created_by" is not null;--> statement-breakpoint
CREATE POLICY "subscription_links_manage" ON "subscription_links" AS PERMISSIVE FOR ALL TO public USING ("subscription_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("subscription_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "subscription_links" FORCE ROW LEVEL SECURITY;