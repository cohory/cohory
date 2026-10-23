CREATE TABLE "course_agent_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"version" text NOT NULL,
	"major" integer NOT NULL,
	"minor" integer NOT NULL,
	"patch" integer NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_agent_versions_course_version_unique" UNIQUE("community_id","course_id","major","minor","patch"),
	CONSTRAINT "course_agent_versions_version_parts" CHECK ("course_agent_versions"."major" >= 0 and "course_agent_versions"."minor" >= 0 and "course_agent_versions"."patch" >= 0 and "course_agent_versions"."version" = "course_agent_versions"."major"::text || '.' || "course_agent_versions"."minor"::text || '.' || "course_agent_versions"."patch"::text),
	CONSTRAINT "course_agent_versions_checksum" CHECK ("course_agent_versions"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "course_agent_versions_changelog_length" CHECK (char_length("course_agent_versions"."changelog") <= 2000),
	CONSTRAINT "course_agent_versions_size" CHECK (octet_length("course_agent_versions"."snapshot"::text) <= 3145728)
);
--> statement-breakpoint
ALTER TABLE "course_agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lesson_agent_layers" (
	"lesson_id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"layer" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_agent_layers_size" CHECK (octet_length("lesson_agent_layers"."layer"::text) <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_agent_versions" ADD CONSTRAINT "course_agent_versions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_agent_versions" ADD CONSTRAINT "course_agent_versions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_agent_versions" ADD CONSTRAINT "course_agent_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" ADD CONSTRAINT "lesson_agent_layers_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" ADD CONSTRAINT "lesson_agent_layers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" ADD CONSTRAINT "lesson_agent_layers_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" ADD CONSTRAINT "lesson_agent_layers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_agent_versions_course_id_idx" ON "course_agent_versions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "course_agent_versions_published_by_idx" ON "course_agent_versions" USING btree ("published_by") WHERE "course_agent_versions"."published_by" is not null;--> statement-breakpoint
CREATE INDEX "lesson_agent_layers_course_idx" ON "lesson_agent_layers" USING btree ("community_id","course_id");--> statement-breakpoint
CREATE INDEX "lesson_agent_layers_course_id_idx" ON "lesson_agent_layers" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "lesson_agent_layers_updated_by_idx" ON "lesson_agent_layers" USING btree ("updated_by") WHERE "lesson_agent_layers"."updated_by" is not null;--> statement-breakpoint
CREATE POLICY "course_agent_versions_read" ON "course_agent_versions" AS PERMISSIVE FOR SELECT TO public USING ("course_agent_versions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "course_agent_versions_publish" ON "course_agent_versions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("course_agent_versions"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "lesson_agent_layers_manage" ON "lesson_agent_layers" AS PERMISSIVE FOR ALL TO public USING ("lesson_agent_layers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on') WITH CHECK ("lesson_agent_layers"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "lesson_agent_layers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_agent_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION cohory_course_agent_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published agent versions are immutable' USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "course_agent_versions_immutable" BEFORE UPDATE ON "course_agent_versions" FOR EACH ROW EXECUTE FUNCTION cohory_course_agent_versions_immutable();
