CREATE TYPE "public"."course_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "course_modules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_modules_title_length" CHECK (char_length("course_modules"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "course_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"slug" "citext" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_key" text,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"position" integer NOT NULL,
	"access" text DEFAULT 'all_members' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_community_slug_unique" UNIQUE("community_id","slug"),
	CONSTRAINT "courses_title_length" CHECK (char_length("courses"."title") between 1 and 120),
	CONSTRAINT "courses_description_length" CHECK (char_length("courses"."description") <= 2000),
	CONSTRAINT "courses_access_values" CHECK ("courses"."access" = 'all_members')
);
--> statement-breakpoint
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"community_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lesson_progress_pkey" PRIMARY KEY("lesson_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "lesson_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"slug" "citext" NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text,
	"video_url" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "lesson_status" DEFAULT 'draft' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_course_slug_unique" UNIQUE("course_id","slug"),
	CONSTRAINT "lessons_title_length" CHECK (char_length("lessons"."title") between 1 and 120),
	CONSTRAINT "lessons_body_length" CHECK (char_length("lessons"."body_markdown") <= 100000),
	CONSTRAINT "lessons_attachments_limit" CHECK (jsonb_array_length("lessons"."attachments") <= 10)
);
--> statement-breakpoint
ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_modules_course_position_idx" ON "course_modules" USING btree ("community_id","course_id","position");--> statement-breakpoint
CREATE INDEX "course_modules_course_id_idx" ON "course_modules" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_community_position_idx" ON "courses" USING btree ("community_id","position");--> statement-breakpoint
CREATE INDEX "lesson_progress_recent_idx" ON "lesson_progress" USING btree ("community_id","user_id","last_viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lesson_progress_course_idx" ON "lesson_progress" USING btree ("community_id","course_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_user_id_idx" ON "lesson_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_course_id_idx" ON "lesson_progress" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "lessons_module_position_idx" ON "lessons" USING btree ("community_id","module_id","position");--> statement-breakpoint
CREATE INDEX "lessons_course_idx" ON "lessons" USING btree ("community_id","course_id");--> statement-breakpoint
CREATE INDEX "lessons_module_id_idx" ON "lessons" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "lessons_course_id_idx" ON "lessons" USING btree ("course_id");--> statement-breakpoint
CREATE POLICY "course_modules_read" ON "course_modules" AS PERMISSIVE FOR SELECT TO public USING ("course_modules"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "course_modules_manage" ON "course_modules" AS PERMISSIVE FOR ALL TO public USING ("course_modules"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on') WITH CHECK ("course_modules"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "courses_published_read" ON "courses" AS PERMISSIVE FOR SELECT TO public USING ("courses"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "courses"."status" = 'published');--> statement-breakpoint
CREATE POLICY "courses_manage" ON "courses" AS PERMISSIVE FOR ALL TO public USING ("courses"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on') WITH CHECK ("courses"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "lesson_progress_own" ON "lesson_progress" AS PERMISSIVE FOR ALL TO public USING ("lesson_progress"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "lesson_progress"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("lesson_progress"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "lesson_progress"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "lesson_progress_manager_read" ON "lesson_progress" AS PERMISSIVE FOR SELECT TO public USING ("lesson_progress"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "lessons_published_read" ON "lessons" AS PERMISSIVE FOR SELECT TO public USING ("lessons"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and "lessons"."status" = 'published');--> statement-breakpoint
CREATE POLICY "lessons_manage" ON "lessons" AS PERMISSIVE FOR ALL TO public USING ("lessons"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on') WITH CHECK ("lessons"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.course_manager', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_modules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lessons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_progress" FORCE ROW LEVEL SECURITY;
