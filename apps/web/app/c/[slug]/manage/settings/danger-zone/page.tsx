import { can } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { getPaymentsService, type PaidMembersSummary } from "@cohory/payments";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  DangerZone,
  type DangerZonePaidMembers,
} from "../../../../../../components/manage/danger-zone";
import { asksWhyCreatorsLeave } from "../../../../../../lib/feedback/service";
import { requireManagePage } from "../../../../../../lib/manage/load";

export const metadata: Metadata = { title: "Danger zone" };

function dangerZonePaidMembers(summary: PaidMembersSummary): DangerZonePaidMembers | null {
  if (summary.connection === "none") {
    return null;
  }
  const archiveRun = summary.run?.kind === "archive" ? summary.run : null;
  const deleteRun = summary.run?.kind === "delete" ? summary.run : null;
  return {
    connection: summary.connection,
    deleteRun: deleteRun
      ? {
          status: deleteRun.status,
          failedCount: deleteRun.failedCount,
          includeLinked: deleteRun.includeLinked,
        }
      : null,
    cohory: summary.cohory,
    linkedImports: summary.linkedImports,
    endingAtPeriodEnd: summary.endingAtPeriodEnd,
    manualCancellation: summary.manualCancellation,
    lastArchiveChoice:
      archiveRun?.choice === "keep_billing" || archiveRun?.choice === "stop_at_period_end"
        ? archiveRun.choice
        : null,
  };
}

export default async function DangerZoneSettingsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/danger-zone">) {
  const manage = await requireManagePage((await params).slug, "settings");
  if (!can(manage.actor, "transfer_ownership", "community", { role: manage.role })) {
    notFound();
  }
  const service = getManageService();
  const [settings, people, paidMembers] = await Promise.all([
    service.getSettings(manage.actor, manage.communityId),
    service.listMembersForManage(manage.actor, manage.communityId, { limit: 100 }),
    getPaymentsService().getPaidMembersSummary(manage.actor, manage.communityId),
  ]);
  const candidates = people.data
    .filter((member) => member.userId !== manage.actor.userId && member.role !== "owner")
    .map((member) => ({ userId: member.userId, name: member.name, username: member.username }));

  return (
    <DangerZone
      slug={manage.slug}
      name={settings.name}
      archived={settings.archivedAt !== null}
      candidates={candidates}
      paidMembers={dangerZonePaidMembers(paidMembers)}
      askWhy={asksWhyCreatorsLeave()}
    />
  );
}
