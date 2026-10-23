import { getManageService } from "@cohory/communities";
import type { Metadata } from "next";

import { GamificationForm } from "../../../../../../components/manage/gamification-form";
import { requireManagePage } from "../../../../../../lib/manage/load";

export const metadata: Metadata = { title: "Points and levels" };

export default async function PointsSettingsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/points">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const settings = await getManageService().getSettings(manage.actor, manage.communityId);

  return (
    <GamificationForm
      slug={manage.slug}
      name={settings.name}
      initial={{
        enabled: settings.gamificationEnabled,
        levelNames: [...settings.levelNames],
        pointsForLessons: settings.pointsForLessons,
        pointsForEvents: settings.pointsForEvents,
      }}
    />
  );
}
