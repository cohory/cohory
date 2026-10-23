CREATE TYPE "public"."reaction_kind" AS ENUM('like');--> statement-breakpoint
CREATE TYPE "public"."reaction_subject_type" AS ENUM('post', 'comment');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" jsonb NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_like_count_nonnegative" CHECK ("comments"."like_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_images_post_position_unique" UNIQUE("post_id","position"),
	CONSTRAINT "post_images_position_range" CHECK ("post_images"."position" >= 0 and "post_images"."position" < 10)
);
--> statement-breakpoint
ALTER TABLE "post_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text,
	"body" jsonb NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"excerpt" text NOT NULL,
	"pinned_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_title_length" CHECK (char_length("posts"."title") <= 120),
	CONSTRAINT "posts_counts_nonnegative" CHECK ("posts"."comment_count" >= 0 and "posts"."like_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_type" "reaction_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_author_id" uuid NOT NULL,
	"kind" "reaction_kind" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_subject_user_kind_unique" UNIQUE("subject_type","subject_id","user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("community_id","post_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_id_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "post_images_post_idx" ON "post_images" USING btree ("community_id","post_id","position");--> statement-breakpoint
CREATE INDEX "posts_feed_idx" ON "posts" USING btree ("community_id","pinned_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_author_id_idx" ON "posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "reactions_subject_idx" ON "reactions" USING btree ("community_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "reactions_user_id_idx" ON "reactions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO public USING ("comments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("comments"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "post_images_tenant_isolation" ON "post_images" AS PERMISSIVE FOR ALL TO public USING ("post_images"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("post_images"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO public USING ("posts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("posts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "reactions_tenant_isolation" ON "reactions" AS PERMISSIVE FOR ALL TO public USING ("reactions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("reactions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_images" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reactions" FORCE ROW LEVEL SECURITY;
