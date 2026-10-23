CREATE TYPE "public"."creator_exit_reason" AS ENUM('too_expensive', 'missing_feature', 'too_hard', 'moving_platform', 'not_enough_activity', 'only_testing', 'other');--> statement-breakpoint
CREATE TYPE "public"."creator_feedback_kind" AS ENUM('moment', 'exit');--> statement-breakpoint
CREATE TYPE "public"."creator_feedback_status" AS ENUM('pending', 'answered', 'dismissed', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."creator_feedback_topic" AS ENUM('first_post', 'first_paid_member', 'first_course', 'archive_community', 'delete_community', 'disconnect_stripe', 'delete_account');--> statement-breakpoint
CREATE TABLE "creator_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"community_id" uuid,
	"kind" "creator_feedback_kind" NOT NULL,
	"topic" "creator_feedback_topic" NOT NULL,
	"status" "creator_feedback_status" NOT NULL,
	"score" smallint,
	"reason" "creator_exit_reason",
	"comment" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_feedback_score_range" CHECK ("creator_feedback"."score" between 1 and 5),
	CONSTRAINT "creator_feedback_comment_length" CHECK (char_length("creator_feedback"."comment") between 1 and 1000),
	CONSTRAINT "creator_feedback_kind_shape" CHECK (("creator_feedback"."kind" = 'moment' and "creator_feedback"."topic" in ('first_post', 'first_paid_member', 'first_course') and "creator_feedback"."reason" is null)
        or ("creator_feedback"."kind" = 'exit' and "creator_feedback"."topic" not in ('first_post', 'first_paid_member', 'first_course') and "creator_feedback"."score" is null and "creator_feedback"."status" = 'answered')),
	CONSTRAINT "creator_feedback_answer_shape" CHECK (("creator_feedback"."status" = 'pending') = ("creator_feedback"."responded_at" is null)
        and ("creator_feedback"."status" = 'answered' or ("creator_feedback"."score" is null and "creator_feedback"."comment" is null)))
);
--> statement-breakpoint
ALTER TABLE "creator_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "creator_feedback_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_feedback" ADD CONSTRAINT "creator_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_feedback" ADD CONSTRAINT "creator_feedback_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_feedback_community_moment_unique" ON "creator_feedback" USING btree ("community_id","topic") WHERE "creator_feedback"."kind" = 'moment';--> statement-breakpoint
CREATE INDEX "creator_feedback_community_idx" ON "creator_feedback" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "creator_feedback_user_responded_idx" ON "creator_feedback" USING btree ("user_id","responded_at");--> statement-breakpoint
CREATE POLICY "creator_feedback_own_rows" ON "creator_feedback" AS PERMISSIVE FOR ALL TO public USING ("creator_feedback"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("creator_feedback"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and ("creator_feedback"."community_id" is null or "creator_feedback"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "creator_feedback_retention_sweep" ON "creator_feedback" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.feedback_retention', true), '') = 'on' and "creator_feedback"."created_at" < now() - interval '24 months') WITH CHECK (false);