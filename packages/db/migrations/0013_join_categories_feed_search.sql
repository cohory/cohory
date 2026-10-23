CREATE TYPE "public"."category_color" AS ENUM('neutral', 'accent', 'info', 'success', 'warning', 'danger');--> statement-breakpoint
CREATE TYPE "public"."membership_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" "citext" NOT NULL,
	"color" "category_color" DEFAULT 'neutral' NOT NULL,
	"position" integer NOT NULL,
	"staff_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_community_slug_unique" UNIQUE("community_id","slug"),
	CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_request_status" DEFAULT 'pending' NOT NULL,
	"answers" jsonb NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_requests_note_length" CHECK (char_length("membership_requests"."decision_note") <= 500),
	CONSTRAINT "membership_requests_answers_limit" CHECK (jsonb_array_length("membership_requests"."answers") <= 3)
);
--> statement-breakpoint
ALTER TABLE "membership_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invite_links" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', body_text)) STORED;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', body_text), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', coalesce(body_markdown, '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_community_position_idx" ON "categories" USING btree ("community_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_requests_one_pending" ON "membership_requests" USING btree ("community_id","user_id") WHERE "membership_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "membership_requests_queue_idx" ON "membership_requests" USING btree ("community_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "membership_requests_user_idx" ON "membership_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "membership_requests_decided_by_idx" ON "membership_requests" USING btree ("decided_by") WHERE "membership_requests"."decided_by" is not null;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_search_idx" ON "users" USING gin (to_tsvector('simple', "name" || ' ' || coalesce("username"::text, '')));--> statement-breakpoint
CREATE INDEX "memberships_bio_search_idx" ON "memberships" USING gin (to_tsvector('simple', coalesce("bio", '')));--> statement-breakpoint
CREATE INDEX "comments_search_idx" ON "comments" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "posts_activity_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,"last_activity_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_top_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,("like_count" + 2 * "comment_count") desc,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_category_feed_idx" ON "posts" USING btree ("community_id","category_id","pinned_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_category_id_idx" ON "posts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "posts_search_idx" ON "posts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "lessons_search_idx" ON "lessons" USING gin ("search_vector");--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO public USING ("categories"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("categories"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_requests_manage" ON "membership_requests" AS PERMISSIVE FOR ALL TO public USING ("membership_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on') WITH CHECK ("membership_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "membership_requests_own_read" ON "membership_requests" AS PERMISSIVE FOR SELECT TO public USING ("membership_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "membership_requests"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_requests_own_insert" ON "membership_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("membership_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "membership_requests"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and "membership_requests"."status" = 'pending');--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "posts" SET "last_activity_at" = coalesce((SELECT max("comments"."created_at") FROM "comments" WHERE "comments"."post_id" = "posts"."id" AND "comments"."deleted_at" IS NULL), "posts"."created_at");--> statement-breakpoint
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "communities" SET "join_mode" = 'approval' WHERE "privacy" = 'private' AND "join_mode" = 'open';--> statement-breakpoint
ALTER TABLE "communities" FORCE ROW LEVEL SECURITY;
