CREATE TYPE "public"."oauth_grant_end_reason" AS ENUM('disconnected', 'revoked', 'refresh_reuse', 'code_reuse');--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "oauth_codes_hash_format" CHECK ("oauth_authorization_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "oauth_codes_challenge_format" CHECK ("oauth_authorization_codes"."code_challenge" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"client_uri" text,
	"software_id" text,
	"software_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_name_length" CHECK (char_length("oauth_clients"."client_name") between 1 and 100),
	CONSTRAINT "oauth_clients_redirect_count" CHECK (cardinality("oauth_clients"."redirect_uris") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" "oauth_grant_end_reason",
	CONSTRAINT "oauth_grants_end_consistent" CHECK (("oauth_grants"."ended_at" is null) = ("oauth_grants"."end_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "oauth_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "oauth_refresh_hash_format" CHECK ("oauth_refresh_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_agent_id_agent_identities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_community_grant_idx" ON "oauth_authorization_codes" USING btree ("community_id","grant_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_grant_id_idx" ON "oauth_authorization_codes" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_clients_created_idx" ON "oauth_clients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "oauth_grants_community_user_idx" ON "oauth_grants" USING btree ("community_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "oauth_grants_community_agent_idx" ON "oauth_grants" USING btree ("community_id","agent_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_id_idx" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_agent_id_idx" ON "oauth_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_ended_by_idx" ON "oauth_grants" USING btree ("ended_by") WHERE "oauth_grants"."ended_by" is not null;--> statement-breakpoint
CREATE INDEX "oauth_refresh_community_grant_idx" ON "oauth_refresh_tokens" USING btree ("community_id","grant_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_grant_id_idx" ON "oauth_refresh_tokens" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_community_grant_idx" ON "api_tokens" USING btree ("community_id","oauth_grant_id") WHERE "api_tokens"."oauth_grant_id" is not null;--> statement-breakpoint
CREATE INDEX "api_tokens_oauth_grant_id_idx" ON "api_tokens" USING btree ("oauth_grant_id") WHERE "api_tokens"."oauth_grant_id" is not null;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_oauth_agent" CHECK ("api_tokens"."oauth_grant_id" is null or "api_tokens"."kind" = 'agent');--> statement-breakpoint
CREATE POLICY "oauth_codes_tenant_isolation" ON "oauth_authorization_codes" AS PERMISSIVE FOR ALL TO public USING ("oauth_authorization_codes"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("oauth_authorization_codes"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "oauth_codes_lookup" ON "oauth_authorization_codes" AS PERMISSIVE FOR SELECT TO public USING ("oauth_authorization_codes"."code_hash" = nullif(current_setting('app.oauth_secret_hash', true), ''));--> statement-breakpoint
CREATE POLICY "oauth_grants_tenant_isolation" ON "oauth_grants" AS PERMISSIVE FOR ALL TO public USING ("oauth_grants"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("oauth_grants"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "oauth_grants_owner_read" ON "oauth_grants" AS PERMISSIVE FOR SELECT TO public USING ("oauth_grants"."user_id" = nullif(current_setting('app.oauth_grant_owner', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "oauth_refresh_tenant_isolation" ON "oauth_refresh_tokens" AS PERMISSIVE FOR ALL TO public USING ("oauth_refresh_tokens"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("oauth_refresh_tokens"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "oauth_refresh_lookup" ON "oauth_refresh_tokens" AS PERMISSIVE FOR SELECT TO public USING ("oauth_refresh_tokens"."token_hash" = nullif(current_setting('app.oauth_secret_hash', true), ''));--> statement-breakpoint
ALTER TABLE "oauth_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" FORCE ROW LEVEL SECURITY;