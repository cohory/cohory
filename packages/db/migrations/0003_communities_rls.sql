ALTER TABLE "communities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "communities_readable" ON "communities" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "communities_tenant_insert" ON "communities" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("communities"."id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "communities_tenant_update" ON "communities" AS PERMISSIVE FOR UPDATE TO public USING ("communities"."id" = nullif(current_setting('app.community_id', true), '')::uuid) WITH CHECK ("communities"."id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "communities_tenant_delete" ON "communities" AS PERMISSIVE FOR DELETE TO public USING ("communities"."id" = nullif(current_setting('app.community_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_own_rows" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING ("memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "communities" FORCE ROW LEVEL SECURITY;
