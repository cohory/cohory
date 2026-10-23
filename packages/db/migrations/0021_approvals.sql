CREATE TYPE "public"."approval_state" AS ENUM('pending', 'approved', 'executed', 'failed', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."notification_subject_type" ADD VALUE 'approval_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_request';--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_id" uuid,
	"operation_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"category" text NOT NULL,
	"input" jsonb NOT NULL,
	"summary" text NOT NULL,
	"diff" jsonb NOT NULL,
	"state" "approval_state" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error_code" text,
	"downloaded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_summary_length" CHECK (char_length("approval_requests"."summary") between 1 and 300),
	CONSTRAINT "approval_requests_note_length" CHECK ("approval_requests"."decision_note" is null or char_length("approval_requests"."decision_note") <= 500),
	CONSTRAINT "approval_requests_decided" CHECK (("approval_requests"."state" in ('pending', 'expired')) = ("approval_requests"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_post_subject";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_community_state_idx" ON "approval_requests" USING btree ("community_id","state","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_requests_community_agent_idx" ON "approval_requests" USING btree ("community_id","agent_id","state");--> statement-breakpoint
CREATE INDEX "approval_requests_expiry_idx" ON "approval_requests" USING btree ("expires_at") WHERE "approval_requests"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_agent_id_idx" ON "approval_requests" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "approval_requests_owner_id_idx" ON "approval_requests" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "approval_requests_token_id_idx" ON "approval_requests" USING btree ("token_id") WHERE "approval_requests"."token_id" is not null;--> statement-breakpoint
CREATE INDEX "approval_requests_decided_by_idx" ON "approval_requests" USING btree ("decided_by") WHERE "approval_requests"."decided_by" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_detail_length" CHECK ("notifications"."detail" is null or char_length("notifications"."detail") <= 300);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_subject" CHECK ("notifications"."post_id" is not null or "notifications"."subject_type"::text in ('membership_request', 'approval_request'));--> statement-breakpoint
CREATE POLICY "approval_requests_access" ON "approval_requests" AS PERMISSIVE FOR ALL TO public USING ("approval_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid or coalesce(current_setting('app.approval_jobs', true), '') = 'on') WITH CHECK ("approval_requests"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid or coalesce(current_setting('app.approval_jobs', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;