import { getManageService } from "@cohory/communities";
import { getPaymentsService } from "@cohory/payments";
import type { Metadata } from "next";

import { AccessForm } from "../../../../../../components/manage/access-form";
import { requireManagePage } from "../../../../../../lib/manage/load";

export const metadata: Metadata = { title: "Joining" };

export default async function JoiningSettingsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/joining">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const [settings, plan] = await Promise.all([
    getManageService().getSettings(manage.actor, manage.communityId),
    getPaymentsService().getPlan(manage.actor, manage.communityId),
  ]);

  return (
    <AccessForm
      slug={manage.slug}
      initial={{
        joinMode: settings.joinMode,
        joinQuestions: settings.joinQuestions.map((question) => ({ ...question })),
      }}
      planOnSale={plan !== null}
    />
  );
}
