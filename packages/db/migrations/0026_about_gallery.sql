CREATE TYPE "public"."gallery_item_kind" AS ENUM('image', 'video_embed');--> statement-breakpoint
CREATE TABLE "community_gallery_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"kind" "gallery_item_kind" NOT NULL,
	"storage_key" text,
	"embed_url" text,
	"position" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_gallery_items_source" CHECK (("community_gallery_items"."kind" = 'image' and "community_gallery_items"."storage_key" is not null and "community_gallery_items"."embed_url" is null) or ("community_gallery_items"."kind" = 'video_embed' and "community_gallery_items"."embed_url" is not null and "community_gallery_items"."storage_key" is null)),
	CONSTRAINT "community_gallery_items_position_range" CHECK ("community_gallery_items"."position" >= 0),
	CONSTRAINT "community_gallery_items_alt_text_length" CHECK (char_length("community_gallery_items"."alt_text") <= 250)
);
--> statement-breakpoint
ALTER TABLE "community_gallery_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_gallery_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "detailed_description" jsonb;--> statement-breakpoint
ALTER TABLE "community_gallery_items" ADD CONSTRAINT "community_gallery_items_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_gallery_items_community_position_idx" ON "community_gallery_items" USING btree ("community_id","position");--> statement-breakpoint
CREATE POLICY "community_gallery_items_readable" ON "community_gallery_items" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "community_gallery_items_manage" ON "community_gallery_items" AS PERMISSIVE FOR ALL TO public USING ("community_gallery_items"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on') WITH CHECK ("community_gallery_items"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.community_manager', true), '') = 'on');