ALTER TYPE "public"."notification_subject_type" ADD VALUE 'agent_token';--> statement-breakpoint
ALTER TYPE "public"."member_removal_reason" ADD VALUE 'hold_expired';--> statement-breakpoint
CREATE TABLE "notification_group_sources" (
	"notification_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"community_id" uuid NOT NULL,
	CONSTRAINT "notification_group_sources_notification_id_source_key_pk" PRIMARY KEY("notification_id","source_key"),
	CONSTRAINT "notification_group_sources_source_key_length" CHECK (char_length("notification_group_sources"."source_key") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "notification_group_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_group_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_holds" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invite_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_holds_pkey" PRIMARY KEY("community_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "membership_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_holds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_group_sources_tenant_isolation" ON "notification_group_sources" AS PERMISSIVE FOR ALL TO public USING ("notification_group_sources"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("notification_group_sources"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_holds_tenant_isolation" ON "membership_holds" AS PERMISSIVE FOR ALL TO public USING ("membership_holds"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("membership_holds"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_holds_sweep_scan" ON "membership_holds" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.membership_hold_sweep', true), '') = 'on');--> statement-breakpoint
CREATE INDEX "notification_group_sources_community_idx" ON "notification_group_sources" USING btree ("community_id","notification_id");--> statement-breakpoint
CREATE INDEX "membership_holds_community_invite_idx" ON "membership_holds" USING btree ("community_id","invite_id");--> statement-breakpoint
CREATE INDEX "membership_holds_expires_idx" ON "membership_holds" USING btree ("expires_at") WHERE "membership_holds"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_links_community_id_unique" ON "invite_links" USING btree ("community_id","id");--> statement-breakpoint
ALTER TABLE "notification_group_sources" ADD CONSTRAINT "notification_group_sources_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_group_sources" ADD CONSTRAINT "notification_group_sources_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_holds" ADD CONSTRAINT "membership_holds_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_holds" ADD CONSTRAINT "membership_holds_membership_fk" FOREIGN KEY ("community_id","user_id") REFERENCES "public"."memberships"("community_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_holds" ADD CONSTRAINT "membership_holds_invite_fk" FOREIGN KEY ("community_id","invite_id") REFERENCES "public"."invite_links"("community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cohory_memberships_removal_reason"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'removed' THEN
    NEW."removal_reason" := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD."status" <> 'removed' THEN
    NEW."removal_reason" := CASE coalesce(current_setting('app.member_removal_reason', true), '')
      WHEN 'left' THEN 'left'::"member_removal_reason"
      WHEN 'removed' THEN 'removed'::"member_removal_reason"
      WHEN 'hold_expired' THEN 'hold_expired'::"member_removal_reason"
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
-- NOT VALID keeps the ACCESS EXCLUSIVE lock to a catalog change: every existing row already passed the narrower check this one widens.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request', 'course_delegation', 'review', 'community', 'report', 'event', 'api_token', 'agent_token')) NOT VALID;
