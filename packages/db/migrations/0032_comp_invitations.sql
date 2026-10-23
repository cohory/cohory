CREATE TABLE "comp_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"granted_by" uuid,
	"note" text,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"comp_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comp_invitations_note_length" CHECK (char_length("comp_invitations"."note") <= 200),
	CONSTRAINT "comp_invitations_one_outcome" CHECK ("comp_invitations"."accepted_at" is null or "comp_invitations"."withdrawn_at" is null)
);
--> statement-breakpoint
ALTER TABLE "comp_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comp_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comp_invitations" ADD CONSTRAINT "comp_invitations_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_invitations" ADD CONSTRAINT "comp_invitations_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_invitations" ADD CONSTRAINT "comp_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_invitations" ADD CONSTRAINT "comp_invitations_comp_id_comped_memberships_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comped_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_invitations" ADD CONSTRAINT "comp_invitations_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comp_invitations_one_open" ON "comp_invitations" USING btree ("community_id","email") WHERE "comp_invitations"."accepted_at" is null and "comp_invitations"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "comp_invitations_community_created_idx" ON "comp_invitations" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "comp_invitations_granted_by_idx" ON "comp_invitations" USING btree ("granted_by") WHERE "comp_invitations"."granted_by" is not null;--> statement-breakpoint
CREATE INDEX "comp_invitations_accepted_by_idx" ON "comp_invitations" USING btree ("accepted_by") WHERE "comp_invitations"."accepted_by" is not null;--> statement-breakpoint
CREATE INDEX "comp_invitations_comp_idx" ON "comp_invitations" USING btree ("comp_id") WHERE "comp_invitations"."comp_id" is not null;--> statement-breakpoint
CREATE INDEX "comp_invitations_withdrawn_by_idx" ON "comp_invitations" USING btree ("withdrawn_by") WHERE "comp_invitations"."withdrawn_by" is not null;--> statement-breakpoint
CREATE POLICY "comp_invitations_manage" ON "comp_invitations" AS PERMISSIVE FOR ALL TO public USING ("comp_invitations"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on') WITH CHECK ("comp_invitations"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.payments_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "comp_invitations_account_purge" ON "comp_invitations" AS PERMISSIVE FOR ALL TO public USING ("comp_invitations"."accepted_by" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("comp_invitations"."accepted_by" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');