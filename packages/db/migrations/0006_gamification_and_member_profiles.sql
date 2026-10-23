CREATE TYPE "public"."points_reason" AS ENUM('like_received', 'like_removed', 'post_deleted', 'comment_deleted', 'admin_reset');--> statement-breakpoint
CREATE TABLE "member_stats" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"points_total" integer DEFAULT 0 NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_stats_pkey" PRIMARY KEY("community_id","user_id"),
	CONSTRAINT "member_stats_level_range" CHECK ("member_stats"."level" between 1 and 9)
);
--> statement-breakpoint
ALTER TABLE "member_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "points_reason" NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "points_ledger_delta_nonzero" CHECK ("points_ledger"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "points_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" "citext";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "member_stats" ADD CONSTRAINT "member_stats_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_stats" ADD CONSTRAINT "member_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_stats_leaderboard_idx" ON "member_stats" USING btree ("community_id","points_total" DESC NULLS LAST,"updated_at","user_id");--> statement-breakpoint
CREATE INDEX "member_stats_community_level_idx" ON "member_stats" USING btree ("community_id","level");--> statement-breakpoint
CREATE INDEX "member_stats_user_id_idx" ON "member_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "points_ledger_community_occurred_idx" ON "points_ledger" USING btree ("community_id","occurred_at");--> statement-breakpoint
CREATE INDEX "points_ledger_community_user_idx" ON "points_ledger" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "points_ledger_user_id_idx" ON "points_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_source_reason_unique" ON "points_ledger" USING btree ("source_type","source_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_one_reversal_per_source" ON "points_ledger" USING btree ("source_type","source_id") WHERE "points_ledger"."reason" in ('like_removed', 'post_deleted', 'comment_deleted');--> statement-breakpoint
CREATE INDEX "users_name_prefix_idx" ON "users" USING btree (lower("name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "users_username_prefix_idx" ON "users" USING btree (lower("username"::text) text_pattern_ops);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_bio_length" CHECK (char_length("memberships"."bio") <= 500);--> statement-breakpoint
CREATE POLICY "member_stats_tenant_isolation" ON "member_stats" AS PERMISSIVE FOR ALL TO public USING ("member_stats"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("member_stats"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "points_ledger_tenant_select" ON "points_ledger" AS PERMISSIVE FOR SELECT TO public USING ("points_ledger"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "points_ledger_tenant_insert" ON "points_ledger" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("points_ledger"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "member_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger" FORCE ROW LEVEL SECURITY;
