CREATE TYPE "public"."member_removal_reason" AS ENUM('left', 'removed');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "removal_reason" "member_removal_reason";--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_removal_reason_only_when_removed" CHECK ("memberships"."removal_reason" is null or "memberships"."status" = 'removed');--> statement-breakpoint
CREATE FUNCTION "cohory_memberships_removal_reason"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'removed' THEN
    NEW."removal_reason" := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD."status" <> 'removed' THEN
    NEW."removal_reason" := CASE coalesce(current_setting('app.member_removal_reason', true), '')
      WHEN 'left' THEN 'left'::"member_removal_reason"
      WHEN 'removed' THEN 'removed'::"member_removal_reason"
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "memberships_removal_reason" BEFORE INSERT OR UPDATE OF "status" ON "memberships" FOR EACH ROW EXECUTE FUNCTION cohory_memberships_removal_reason();--> statement-breakpoint
UPDATE "memberships" SET "removal_reason" = 'left'
FROM (
  SELECT DISTINCT ON ("outbox"."community_id", "event"->'payload'->>'userId')
    "outbox"."community_id",
    "outbox"."created_at",
    "event"->'payload'->>'userId' AS "user_id",
    "event"->>'type' AS "type",
    "event"->'payload'->>'reason' AS "reason"
  FROM "outbox",
    jsonb_array_elements(
      CASE WHEN jsonb_typeof("outbox"."payload"->'events') = 'array' THEN "outbox"."payload"->'events' ELSE '[]'::jsonb END
    ) AS "event"
  WHERE "outbox"."topic" = 'domain_events'
    AND "event"->>'type' IN ('member.joined', 'member.removed')
  ORDER BY "outbox"."community_id", "event"->'payload'->>'userId', "outbox"."created_at" DESC, "outbox"."id" DESC
) AS "latest"
WHERE "latest"."type" = 'member.removed'
  AND "latest"."reason" = 'left'
  AND "memberships"."community_id" = "latest"."community_id"
  AND "memberships"."user_id"::text = "latest"."user_id"
  AND "memberships"."status" = 'removed'
  AND "memberships"."removal_reason" IS NULL
  AND "memberships"."updated_at" <= "latest"."created_at" + interval '2 seconds'
  AND NOT EXISTS (
    SELECT 1 FROM "audit_log"
    WHERE "audit_log"."community_id" = "memberships"."community_id"
      AND "audit_log"."target" = "memberships"."user_id"::text
      AND "audit_log"."created_at" >= "latest"."created_at"
  );
