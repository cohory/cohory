ALTER TYPE "public"."notification_type" ADD VALUE 'report_actioned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'report_dismissed';--> statement-breakpoint
CREATE POLICY "comped_memberships_account_purge" ON "comped_memberships" AS PERMISSIVE FOR ALL TO public USING ("comped_memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("comped_memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "membership_requests_account_purge" ON "membership_requests" AS PERMISSIVE FOR ALL TO public USING ("membership_requests"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("membership_requests"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "content_reports_account_purge" ON "content_reports" AS PERMISSIVE FOR ALL TO public USING ("content_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on') WITH CHECK ("content_reports"."reporter_id" = nullif(current_setting('app.user_id', true), '')::uuid and coalesce(current_setting('app.account_purge', true), '') = 'on');--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cohory_memberships_domain_events"() RETURNS trigger LANGUAGE plpgsql AS $$
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
      jsonb_build_object(
        'userId', NEW."user_id",
        'status', NEW."status",
        'reason', CASE
          WHEN NEW."status" = 'banned' THEN 'banned'
          WHEN current_setting('app.member_removal_reason', true) = 'left' THEN 'left'
          ELSE 'removed'
        END
      )
    );
  END IF;
  RETURN NULL;
END
$$;
