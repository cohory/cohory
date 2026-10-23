CREATE TABLE "community_slug_history" (
	"slug" "citext" PRIMARY KEY NOT NULL,
	"community_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_slug_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_slug_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "slug_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_slug_history" ADD CONSTRAINT "community_slug_history_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_slug_history_community_changed_idx" ON "community_slug_history" USING btree ("community_id","changed_at");--> statement-breakpoint
CREATE POLICY "community_slug_history_readable" ON "community_slug_history" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "community_slug_history_tenant_insert" ON "community_slug_history" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("community_slug_history"."community_id" = nullif(current_setting('app.community_id', true), '')::uuid);;--> statement-breakpoint
CREATE FUNCTION "cohory_communities_slug_history"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  lock_key integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."slug" = OLD."slug" THEN
    RETURN NEW;
  END IF;
  FOR lock_key IN
    SELECT DISTINCT hashtext(lower(candidate))
    FROM unnest(ARRAY[NEW."slug"::text, CASE WHEN TG_OP = 'UPDATE' THEN OLD."slug"::text END]) AS candidate
    WHERE candidate IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(727002, lock_key);
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM "community_slug_history"
    WHERE "slug" = NEW."slug" AND "community_id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'community slug % was used by another community', NEW."slug"
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'communities_slug_unique';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO "community_slug_history" ("slug", "community_id")
    VALUES (OLD."slug", NEW."id")
    ON CONFLICT ("slug") DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "communities_slug_history" BEFORE INSERT OR UPDATE OF "slug" ON "communities" FOR EACH ROW EXECUTE FUNCTION cohory_communities_slug_history();
