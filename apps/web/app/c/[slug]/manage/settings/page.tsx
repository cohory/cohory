import { can } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import { Download } from "lucide-react";
import type { Metadata } from "next";

import { CommunityUrlForm } from "../../../../../components/manage/community-url-form";
import { GeneralForm } from "../../../../../components/manage/general-form";
import { ReviewsForm } from "../../../../../components/manage/reviews-form";
import { requireManagePage } from "../../../../../lib/manage/load";
import { slugChangeDate } from "../../../../../lib/manage/slug";
import { appUrl } from "../../../../../lib/manage/views";

export const metadata: Metadata = { title: "Settings" };

export default async function ManageSettingsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const service = getManageService();
  const context = { role: manage.role };
  const [settings, slugStatus] = await Promise.all([
    service.getSettings(manage.actor, manage.communityId),
    service.getSlugStatus(manage.actor, manage.communityId),
  ]);

  return (
    <>
      <GeneralForm
        slug={manage.slug}
        initial={{
          name: settings.name,
          privacy: settings.privacy,
        }}
      />
      <CommunityUrlForm
        slug={slugStatus.slug}
        origin={appUrl()}
        isOwner={can(manage.actor, "transfer_ownership", "community", context)}
        canChange={slugStatus.canChange}
        nextChangeLabel={slugStatus.nextChangeAt ? slugChangeDate(slugStatus.nextChangeAt) : null}
      />
      <ReviewsForm slug={manage.slug} initial={settings.reviewsEnabled} />
      {can(manage.actor, "members", "export", context) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Export your data</CardTitle>
            <CardDescription>
              Download everyone in your community as a spreadsheet file. Your data is yours to keep.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" className="min-h-11">
              <a href={`/api/v1/communities/${manage.slug}/manage/export/members.csv`} download>
                <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
                Download members CSV
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
