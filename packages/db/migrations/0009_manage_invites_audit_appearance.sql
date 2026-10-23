CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_links_token_unique" UNIQUE("token"),
	CONSTRAINT "invite_links_max_uses_positive" CHECK ("invite_links"."max_uses" is null or "invite_links"."max_uses" > 0),
	CONSTRAINT "invite_links_use_count_range" CHECK ("invite_links"."use_count" >= 0 and ("invite_links"."max_uses" is null or "invite_links"."use_count" <= "invite_links"."max_uses"))
);
--> statement-breakpoint
ALTER TABLE "invite_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "appearance_tokens" jsonb;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "banned_email" "citext";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_community_created_idx" ON "audit_log" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "invite_links_community_created_idx" ON "invite_links" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "memberships_community_banned_email_idx" ON "memberships" USING btree ("community_id","banned_email") WHERE "memberships"."banned_email" is not null;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_banned_email_only_when_banned" CHECK ("memberships"."banned_email" is null or "memberships"."status" = 'banned');--> statement-breakpoint
CREATE POLICY "audit_log_tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("audit_log"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_manager_read" ON "audit_log" AS PERMISSIVE FOR SELECT TO public USING ("audit_log"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "invite_links_manage" ON "invite_links" AS PERMISSIVE FOR ALL TO public USING ("invite_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on') WITH CHECK ("invite_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "invite_links_redeem_read" ON "invite_links" AS PERMISSIVE FOR SELECT TO public USING ("invite_links"."token" = nullif(current_setting('app.invite_token', true), ''));--> statement-breakpoint
CREATE POLICY "invite_links_redeem_update" ON "invite_links" AS PERMISSIVE FOR UPDATE TO public USING ("invite_links"."token" = nullif(current_setting('app.invite_token', true), '') and "invite_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("invite_links"."token" = nullif(current_setting('app.invite_token', true), '') and "invite_links"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invite_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
