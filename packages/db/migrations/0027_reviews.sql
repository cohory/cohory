CREATE TYPE "public"."review_hidden_reason" AS ENUM('spam', 'abuse', 'personal_data', 'off_topic');--> statement-breakpoint
CREATE TYPE "public"."review_report_status" AS ENUM('open', 'dismissed', 'hidden');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'review';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'review_created';--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_replies_body_length" CHECK (char_length("review_replies"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "review_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text,
	"status" "review_report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_reports_note_length" CHECK (char_length("review_reports"."note") <= 500),
	CONSTRAINT "review_reports_resolution" CHECK (("review_reports"."status" = 'open') = ("review_reports"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "review_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"author_id" uuid,
	"membership_id" uuid,
	"rating" smallint NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_reason" "review_hidden_reason",
	"hidden_by" uuid,
	"author_removed_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_one_per_member" UNIQUE("community_id","author_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body_length" CHECK (char_length("reviews"."body") between 20 and 2000),
	CONSTRAINT "reviews_hidden_consistent" CHECK (("reviews"."hidden_at" is null) = ("reviews"."hidden_reason" is null)),
	CONSTRAINT "reviews_author_or_anonymized" CHECK ("reviews"."author_id" is not null or "reviews"."anonymized_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "reviews_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_replies_community_idx" ON "review_replies" USING btree ("community_id","review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_replies_one_per_review" ON "review_replies" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_replies_author_idx" ON "review_replies" USING btree ("author_id") WHERE "review_replies"."author_id" is not null;--> statement-breakpoint
CREATE INDEX "review_reports_queue_idx" ON "review_reports" USING btree ("community_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_one_open" ON "review_reports" USING btree ("community_id","review_id","reporter_id") WHERE "review_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "review_reports_review_idx" ON "review_reports" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_reports_reporter_idx" ON "review_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "review_reports_resolved_by_idx" ON "review_reports" USING btree ("resolved_by") WHERE "review_reports"."resolved_by" is not null;--> statement-breakpoint
CREATE INDEX "reviews_community_created_idx" ON "reviews" USING btree ("community_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_community_rating_idx" ON "reviews" USING btree ("community_id","rating");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "reviews" USING btree ("author_id") WHERE "reviews"."author_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_membership_idx" ON "reviews" USING btree ("membership_id") WHERE "reviews"."membership_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_hidden_by_idx" ON "reviews" USING btree ("hidden_by") WHERE "reviews"."hidden_by" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request', 'course_delegation', 'review'));--> statement-breakpoint
CREATE POLICY "review_replies_tenant_isolation" ON "review_replies" AS PERMISSIVE FOR ALL TO public USING ("review_replies"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("review_replies"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "review_reports_tenant_isolation" ON "review_reports" AS PERMISSIVE FOR ALL TO public USING ("review_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("review_reports"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "review_reports_account_purge" ON "review_reports" AS PERMISSIVE FOR ALL TO public USING ("review_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("review_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "reviews_tenant_isolation" ON "reviews" AS PERMISSIVE FOR ALL TO public USING ("reviews"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("reviews"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "reviews_account_purge" ON "reviews" AS PERMISSIVE FOR ALL TO public USING ("reviews"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("reviews"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_replies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION "cohory_reviews_author_standing"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  previous text := current_setting('app.community_id', true);
BEGIN
  IF NEW."status" = 'banned'
    OR (NEW."status" = 'removed' AND coalesce(current_setting('app.member_removal_reason', true), '') = 'removed') THEN
    PERFORM set_config('app.community_id', NEW."community_id"::text, true);
    UPDATE "reviews" SET "author_removed_at" = now()
      WHERE "community_id" = NEW."community_id" AND "author_id" = NEW."user_id" AND "author_removed_at" IS NULL;
    PERFORM set_config('app.community_id', coalesce(previous, ''), true);
  ELSIF NEW."status" = 'active' THEN
    PERFORM set_config('app.community_id', NEW."community_id"::text, true);
    UPDATE "reviews" SET "author_removed_at" = NULL
      WHERE "community_id" = NEW."community_id" AND "author_id" = NEW."user_id" AND "author_removed_at" IS NOT NULL;
    PERFORM set_config('app.community_id', coalesce(previous, ''), true);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "memberships_review_standing" AFTER UPDATE OF "status" ON "memberships" FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status") EXECUTE FUNCTION cohory_reviews_author_standing();
