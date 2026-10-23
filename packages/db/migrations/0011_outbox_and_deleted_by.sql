CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_community_idx" ON "outbox" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("created_at","id") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_published_idx" ON "outbox" USING btree ("published_at") WHERE "outbox"."published_at" is not null;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_deleted_by_idx" ON "comments" USING btree ("deleted_by") WHERE "comments"."deleted_by" is not null;--> statement-breakpoint
CREATE INDEX "posts_deleted_by_idx" ON "posts" USING btree ("deleted_by") WHERE "posts"."deleted_by" is not null;--> statement-breakpoint
CREATE POLICY "outbox_append" ON "outbox" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("outbox"."community_id" is null or "outbox"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay" ON "outbox" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.outbox_relay', true), '') = 'on') WITH CHECK (coalesce(current_setting('app.outbox_relay', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "outbox" FORCE ROW LEVEL SECURITY;
