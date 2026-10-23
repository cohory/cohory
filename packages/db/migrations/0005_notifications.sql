CREATE TYPE "public"."notification_subject_type" AS ENUM('post', 'comment');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'reply', 'comment_on_post', 'like_on_post', 'like_on_comment');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"subject_type" "notification_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_community_idx" ON "notifications" USING btree ("community_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_dedupe" ON "notifications" USING btree ("user_id","type","subject_id","actor_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE POLICY "notifications_tenant_insert" ON "notifications" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("notifications"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_own_rows_select" ON "notifications" AS PERMISSIVE FOR SELECT TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_own_rows_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
