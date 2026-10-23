CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_via" AS ENUM('web', 'api', 'mcp', 'job');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."api_token_kind" AS ENUM('personal', 'agent');--> statement-breakpoint
CREATE TABLE "post_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"agent_id" uuid,
	"category_id" uuid,
	"title" text,
	"body" jsonb NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"excerpt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_drafts_title_length" CHECK (char_length("post_drafts"."title") <= 120)
);
--> statement-breakpoint
ALTER TABLE "post_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"community_wide" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_name_length" CHECK (char_length("agent_identities"."name") between 1 and 60),
	CONSTRAINT "agent_identities_description_length" CHECK ("agent_identities"."description" is null or char_length("agent_identities"."description") <= 280)
);
--> statement-breakpoint
ALTER TABLE "agent_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"kind" "api_token_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_kind_agent" CHECK (("api_tokens"."kind" = 'agent') = ("api_tokens"."agent_id" is not null)),
	CONSTRAINT "api_tokens_name_length" CHECK (char_length("api_tokens"."name") between 1 and 60),
	CONSTRAINT "api_tokens_hash_format" CHECK ("api_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_type" "audit_actor_type";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "via" "audit_via";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_drafts_community_author_idx" ON "post_drafts" USING btree ("community_id","author_id","created_at");--> statement-breakpoint
CREATE INDEX "post_drafts_author_id_idx" ON "post_drafts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "post_drafts_agent_id_idx" ON "post_drafts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "post_drafts_category_id_idx" ON "post_drafts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "agent_identities_community_created_idx" ON "agent_identities" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_identities_community_owner_idx" ON "agent_identities" USING btree ("community_id","owner_id");--> statement-breakpoint
CREATE INDEX "agent_identities_owner_id_idx" ON "agent_identities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_identities_created_by_idx" ON "agent_identities" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "api_tokens_community_user_idx" ON "api_tokens" USING btree ("community_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_tokens_community_agent_idx" ON "api_tokens" USING btree ("community_id","agent_id") WHERE "api_tokens"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tokens_agent_id_idx" ON "api_tokens" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "api_tokens_created_by_idx" ON "api_tokens" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "api_tokens_revoked_by_idx" ON "api_tokens" USING btree ("revoked_by") WHERE "api_tokens"."revoked_by" is not null;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_agent_idx" ON "comments" USING btree ("community_id","agent_id") WHERE "comments"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "comments_agent_id_idx" ON "comments" USING btree ("agent_id") WHERE "comments"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_agent_idx" ON "posts" USING btree ("community_id","agent_id") WHERE "posts"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_agent_id_idx" ON "posts" USING btree ("agent_id") WHERE "posts"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_community_agent_idx" ON "audit_log" USING btree ("community_id","agent_id","created_at") WHERE "audit_log"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_community_token_idx" ON "audit_log" USING btree ("community_id","token_id","created_at") WHERE "audit_log"."token_id" is not null;--> statement-breakpoint
CREATE POLICY "post_drafts_tenant_isolation" ON "post_drafts" AS PERMISSIVE FOR ALL TO public USING ("post_drafts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("post_drafts"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agent_identities_tenant_isolation" ON "agent_identities" AS PERMISSIVE FOR ALL TO public USING ("agent_identities"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("agent_identities"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "api_tokens_tenant_isolation" ON "api_tokens" AS PERMISSIVE FOR ALL TO public USING ("api_tokens"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("api_tokens"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "api_tokens_lookup" ON "api_tokens" AS PERMISSIVE FOR SELECT TO public USING ("api_tokens"."token_hash" = nullif(current_setting('app.api_token_hash', true), ''));--> statement-breakpoint
CREATE POLICY "api_tokens_owner_read" ON "api_tokens" AS PERMISSIVE FOR SELECT TO public USING ("api_tokens"."kind" = 'personal' and "api_tokens"."user_id" = nullif(current_setting('app.api_token_owner', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "api_tokens_owner_revoke" ON "api_tokens" AS PERMISSIVE FOR UPDATE TO public USING ("api_tokens"."kind" = 'personal' and "api_tokens"."user_id" = nullif(current_setting('app.api_token_owner', true), '')::uuid) WITH CHECK ("api_tokens"."kind" = 'personal' and "api_tokens"."user_id" = nullif(current_setting('app.api_token_owner', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "agent_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_drafts" FORCE ROW LEVEL SECURITY;