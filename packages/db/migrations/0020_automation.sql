CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_disabled_reason" AS ENUM('manual', 'failures');--> statement-breakpoint
CREATE TYPE "public"."webhook_endpoint_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"response_status" integer,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_endpoint_event_unique" UNIQUE("endpoint_id","event_id"),
	CONSTRAINT "webhook_deliveries_attempts_nonnegative" CHECK ("webhook_deliveries"."attempts" >= 0),
	CONSTRAINT "webhook_deliveries_pending_scheduled" CHECK ("webhook_deliveries"."status" <> 'pending' or "webhook_deliveries"."next_attempt_at" is not null),
	CONSTRAINT "webhook_deliveries_error_length" CHECK (char_length("webhook_deliveries"."last_error") <= 200)
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"event_types" text[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"status" "webhook_endpoint_status" DEFAULT 'active' NOT NULL,
	"disabled_reason" "webhook_disabled_reason",
	"disabled_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_url_length" CHECK (char_length("webhook_endpoints"."url") between 8 and 2048),
	CONSTRAINT "webhook_endpoints_description_length" CHECK ("webhook_endpoints"."description" is null or char_length("webhook_endpoints"."description") <= 200),
	CONSTRAINT "webhook_endpoints_event_types_present" CHECK (cardinality("webhook_endpoints"."event_types") >= 1),
	CONSTRAINT "webhook_endpoints_disabled_state" CHECK (("webhook_endpoints"."status" = 'active') = ("webhook_endpoints"."disabled_at" is null and "webhook_endpoints"."disabled_reason" is null)),
	CONSTRAINT "webhook_endpoints_failures_nonnegative" CHECK ("webhook_endpoints"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("community_id","endpoint_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_in_flight_idx" ON "webhook_deliveries" USING btree ("endpoint_id","locked_until") WHERE "webhook_deliveries"."status" = 'pending' and "webhook_deliveries"."locked_until" is not null;--> statement-breakpoint
CREATE INDEX "webhook_endpoints_community_idx" ON "webhook_endpoints" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_created_by_idx" ON "webhook_endpoints" USING btree ("created_by") WHERE "webhook_endpoints"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "memberships_community_last_seen_idx" ON "memberships" USING btree ("community_id","last_seen_at") WHERE "memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "posts_scheduled_idx" ON "posts" USING btree ("community_id","scheduled_at","id") WHERE "posts"."scheduled_at" is not null and "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_scheduled_due_idx" ON "posts" USING btree ("scheduled_at") WHERE "posts"."scheduled_at" is not null and "posts"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "posts_scheduler_read" ON "posts" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.posts_scheduler', true), '') = 'on' and "posts"."scheduled_at" is not null);--> statement-breakpoint
CREATE POLICY "webhook_deliveries_access" ON "webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING (("webhook_deliveries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on') WITH CHECK (("webhook_deliveries"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "webhook_endpoints_access" ON "webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING (("webhook_endpoints"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on') WITH CHECK (("webhook_endpoints"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid and coalesce(current_setting('app.webhooks_manager', true), '') = 'on') or coalesce(current_setting('app.webhook_jobs', true), '') = 'on');--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION "cohory_uuid_v7"() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;--> statement-breakpoint
CREATE FUNCTION "cohory_append_domain_event"("p_community_id" uuid, "p_type" text, "p_payload" jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  previous text := current_setting('app.community_id', true);
BEGIN
  IF coalesce(current_setting('app.migration_manager', true), '') = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config('app.community_id', p_community_id::text, true);
  INSERT INTO "outbox" ("id", "community_id", "topic", "payload")
  VALUES (
    cohory_uuid_v7(),
    p_community_id,
    'domain_events',
    jsonb_build_object(
      'events',
      jsonb_build_array(
        jsonb_build_object(
          'type', p_type,
          'payload', p_payload || jsonb_build_object(
            'communityId', p_community_id,
            'occurredAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )
        )
      )
    )
  );
  PERFORM set_config('app.community_id', coalesce(previous, ''), true);
END
$$;--> statement-breakpoint
CREATE FUNCTION "cohory_touch_last_seen"("p_community_id" uuid, "p_user_id" uuid, "p_at" timestamp with time zone) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  previous text := current_setting('app.community_id', true);
BEGIN
  PERFORM set_config('app.community_id', p_community_id::text, true);
  UPDATE "memberships"
  SET "last_seen_at" = p_at
  WHERE "community_id" = p_community_id
    AND "user_id" = p_user_id
    AND ("last_seen_at" IS NULL OR "last_seen_at" < p_at - interval '1 hour');
  PERFORM set_config('app.community_id', coalesce(previous, ''), true);
END
$$;--> statement-breakpoint
CREATE FUNCTION "cohory_memberships_domain_events"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'active' AND (TG_OP = 'INSERT' OR OLD."status" <> 'active') THEN
    PERFORM cohory_append_domain_event(
      NEW."community_id",
      'member.joined',
      jsonb_build_object('userId', NEW."user_id", 'role', NEW."role")
    );
  ELSIF TG_OP = 'UPDATE' AND OLD."status" = 'active' AND NEW."status" <> 'active' THEN
    PERFORM cohory_append_domain_event(
      NEW."community_id",
      'member.removed',
      jsonb_build_object('userId', NEW."user_id", 'status', NEW."status")
    );
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "memberships_domain_events" AFTER INSERT OR UPDATE OF "status" ON "memberships" FOR EACH ROW EXECUTE FUNCTION cohory_memberships_domain_events();--> statement-breakpoint
CREATE FUNCTION "cohory_lesson_progress_activity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."completed_at" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."completed_at" IS NULL) THEN
    PERFORM cohory_append_domain_event(
      NEW."community_id",
      'lesson.completed',
      jsonb_build_object('userId', NEW."user_id", 'courseId', NEW."course_id", 'lessonId', NEW."lesson_id")
    );
  END IF;
  PERFORM cohory_touch_last_seen(NEW."community_id", NEW."user_id", NEW."last_viewed_at");
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "lesson_progress_activity" AFTER INSERT OR UPDATE OF "completed_at", "last_viewed_at" ON "lesson_progress" FOR EACH ROW EXECUTE FUNCTION cohory_lesson_progress_activity();--> statement-breakpoint
CREATE FUNCTION "cohory_event_rsvps_activity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  occurrence_event uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."status" = NEW."status" THEN
    RETURN NULL;
  END IF;
  SELECT "event_id" INTO occurrence_event FROM "event_occurrences" WHERE "id" = NEW."occurrence_id";
  PERFORM cohory_append_domain_event(
    NEW."community_id",
    'event.rsvp_changed',
    jsonb_build_object(
      'userId', NEW."user_id",
      'eventId', occurrence_event,
      'occurrenceId', NEW."occurrence_id",
      'status', NEW."status"
    )
  );
  PERFORM cohory_touch_last_seen(NEW."community_id", NEW."user_id", NEW."updated_at");
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "event_rsvps_activity" AFTER INSERT OR UPDATE OF "status" ON "event_rsvps" FOR EACH ROW EXECUTE FUNCTION cohory_event_rsvps_activity();--> statement-breakpoint
CREATE FUNCTION "cohory_subscriptions_domain_events"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  had_access boolean := TG_OP = 'UPDATE' AND OLD."access_state" IN ('granted', 'grace');
  has_access boolean := NEW."access_state" IN ('granted', 'grace');
BEGIN
  IF has_access AND NOT had_access THEN
    PERFORM cohory_append_domain_event(
      NEW."community_id",
      'subscription.activated',
      jsonb_build_object('userId', NEW."user_id", 'subscriptionId', NEW."id", 'planId', NEW."plan_id")
    );
  ELSIF had_access AND NOT has_access THEN
    PERFORM cohory_append_domain_event(
      NEW."community_id",
      'subscription.ended',
      jsonb_build_object('userId', NEW."user_id", 'subscriptionId', NEW."id", 'planId', NEW."plan_id")
    );
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "subscriptions_domain_events" AFTER INSERT OR UPDATE OF "access_state" ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION cohory_subscriptions_domain_events();--> statement-breakpoint
CREATE FUNCTION "cohory_content_activity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cohory_touch_last_seen(
    NEW."community_id",
    (to_jsonb(NEW) ->> TG_ARGV[0])::uuid,
    NEW."created_at"
  );
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "posts_activity" AFTER INSERT ON "posts" FOR EACH ROW EXECUTE FUNCTION cohory_content_activity('author_id');--> statement-breakpoint
CREATE TRIGGER "comments_activity" AFTER INSERT ON "comments" FOR EACH ROW EXECUTE FUNCTION cohory_content_activity('author_id');--> statement-breakpoint
CREATE TRIGGER "reactions_activity" AFTER INSERT ON "reactions" FOR EACH ROW EXECUTE FUNCTION cohory_content_activity('user_id');
