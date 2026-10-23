import { can } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { getMigrationService } from "@cohory/migration";
import { getPaymentsService } from "@cohory/payments";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InviteLinks } from "../../../../../components/manage/invite-links";
import { PeopleList } from "../../../../../components/manage/people-list";
import { requireManagePage } from "../../../../../lib/manage/load";
import { loadMemberDetail } from "../../../../../lib/manage/member-detail";
import { parsePeopleFilters, peopleFiltersToInput } from "../../../../../lib/manage/people-filters";
import { appUrl, toInviteRow, toPersonRow } from "../../../../../lib/manage/views";

const inboxQueues = new Set(["requests", "reports"]);

export const metadata: Metadata = { title: "People" };

export default async function ManagePeoplePage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/people">) {
  const query = await searchParams;
  const manage = await requireManagePage((await params).slug, "people", query);
  if (typeof query.tab === "string" && inboxQueues.has(query.tab)) {
    const status = query.tab === "reports" && query.reports === "closed" ? "&reports=closed" : "";
    redirect(`/c/${manage.slug}/manage/inbox?tab=${query.tab}${status}`);
  }
  const service = getManageService();
  const viewer = { actor: manage.actor, role: manage.role };
  const canInvite = can(manage.actor, "manage", "invite", { role: manage.role });
  const canReadSettings = can(manage.actor, "read", "settings", { role: manage.role });
  const canSeeAccess = can(manage.actor, "read", "payment", { role: manage.role });
  const filters = parsePeopleFilters(query);
  const peopleFilters = canSeeAccess ? filters : { ...filters, access: "" as const };
  const peopleInput = peopleFiltersToInput(peopleFilters) ?? {};
  const memberId = typeof query.member === "string" ? query.member : null;
  const [people, invites, settings, detail, plan, resendable] = await Promise.all([
    service.listMembersForManage(manage.actor, manage.communityId, peopleInput),
    canInvite ? service.listInviteLinks(manage.actor, manage.communityId) : Promise.resolve([]),
    canReadSettings ? service.getSettings(manage.actor, manage.communityId) : Promise.resolve(null),
    memberId ? loadMemberDetail(viewer, manage.communityId, memberId) : Promise.resolve(null),
    canInvite ? getPaymentsService().getPlan(manage.actor, manage.communityId) : null,
    manage.role === "owner"
      ? getMigrationService().resendableMembers(manage.actor, manage.communityId)
      : Promise.resolve([]),
  ]);
  const base = appUrl();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-text">People</h2>
        {canInvite ? (
          <InviteLinks
            slug={manage.slug}
            planOnSale={plan !== null}
            invites={invites.map((invite) => toInviteRow(base, invite))}
          />
        ) : null}
      </div>
      <PeopleList
        slug={manage.slug}
        gamificationEnabled={settings?.gamificationEnabled ?? true}
        showEmail={can(manage.actor, "read_email", "membership", { role: manage.role })}
        canExport={can(manage.actor, "members", "export", { role: manage.role })}
        canSeeAccess={canSeeAccess}
        initialFilters={peopleFilters}
        initialRows={people.data.map((member) => toPersonRow(viewer, member))}
        initialCursor={people.nextCursor}
        initialDetail={detail}
        resendable={resendable}
      />
    </>
  );
}
