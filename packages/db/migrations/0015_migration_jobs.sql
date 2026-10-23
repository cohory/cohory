CREATE TYPE "public"."migration_job_kind" AS ENUM('export', 'import', 'members_csv');--> statement-breakpoint
CREATE TYPE "public"."migration_job_status" AS ENUM('ready', 'queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "migration_id_map" (
	"community_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "migration_id_map_pkey" PRIMARY KEY("community_id","job_id","entity","source_id")
);
--> statement-breakpoint
ALTER TABLE "migration_id_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "migration_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"kind" "migration_job_kind" NOT NULL,
	"status" "migration_job_status" NOT NULL,
	"requested_by" uuid,
	"file_key" text,
	"file_name" text,
	"file_bytes" bigint,
	"options" jsonb,
	"preview" jsonb,
	"progress" jsonb,
	"summary" jsonb,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "migration_id_map" ADD CONSTRAINT "migration_id_map_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_id_map" ADD CONSTRAINT "migration_id_map_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_id_map_job_idx" ON "migration_id_map" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "migration_jobs_community_created_idx" ON "migration_jobs" USING btree ("community_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "migration_jobs_requested_by_idx" ON "migration_jobs" USING btree ("requested_by") WHERE "migration_jobs"."requested_by" is not null;--> statement-breakpoint
CREATE POLICY "migration_id_map_manage" ON "migration_id_map" AS PERMISSIVE FOR ALL TO public USING ("migration_id_map"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.migration_manager', true), '') = 'on') WITH CHECK ("migration_id_map"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.migration_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "migration_jobs_manage" ON "migration_jobs" AS PERMISSIVE FOR ALL TO public USING ("migration_jobs"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.migration_manager', true), '') = 'on') WITH CHECK ("migration_jobs"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.migration_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "migration_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "migration_id_map" FORCE ROW LEVEL SECURITY;
