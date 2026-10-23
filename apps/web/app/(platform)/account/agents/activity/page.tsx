import { getAgentsService } from "@cohory/agents";
import {
  CommunityValidationError,
  getCommunitiesService,
  getManageService,
  type AuditLogPage,
} from "@cohory/communities";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuditDetails, AuditWhoCell } from "../../../../../components/manage/audit-row";
import { actorFor } from "../../../../../lib/actor";
import { activitySubject } from "../../../../../lib/agents/activity";
import { auditActionLabel, auditFiltersFrom, viaLabels } from "../../../../../lib/manage/audit";
import { requireAccountSession } from "../../session";

export const metadata: Metadata = { title: "Agent activity" };

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const linkClass =
  "inline-flex min-h-11 items-center self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export default async function AgentActivityPage({
  searchParams,
}: PageProps<"/account/agents/activity">) {
  const session = await requireAccountSession("/account/agents");
  const actor = actorFor(session);
  const query = await searchParams;
  const memberships = await getCommunitiesService().listCommunitiesForUser(actor);
  const current = memberships.find(({ community }) => community.slug === query.community);
  if (!current) {
    notFound();
  }
  const community = current.community;
  const { agentId, tokenId, cursor } = auditFiltersFrom(query);
  const [agents, personalTokens] = await Promise.all([
    getAgentsService().listOwnAgents(actor, community.id),
    getAgentsService().listPersonalTokens(actor),
  ]);
  let page: AuditLogPage = { data: [], nextCursor: null, actions: [] };
  let problem: string | null = null;
  try {
    page = await getManageService().listOwnActivity(actor, community.id, {
      ...(agentId ? { agentId } : {}),
      ...(tokenId ? { tokenId } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch (error) {
    if (!(error instanceof CommunityValidationError)) throw error;
    problem = "This list could not be loaded. Start again from Agents.";
  }
  const back = `/account/agents?community=${encodeURIComponent(community.slug)}`;
  const subject = activitySubject(
    { ...(agentId ? { agentId } : {}), ...(tokenId ? { tokenId } : {}) },
    agents,
    personalTokens.filter((item) => item.communityId === community.id),
  );
  const older = (next: string) =>
    `/account/agents/activity?${new URLSearchParams({
      community: community.slug,
      ...(agentId ? { agentId } : {}),
      ...(tokenId ? { tokenId } : {}),
      cursor: next,
    }).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <Link href={back} className={linkClass}>
        Back to Agents
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold break-words text-text">Activity: {subject}</h1>
        <p className="text-sm text-text-muted">
          Changes made in {community.name} with your agents and API tokens, newest first. Reading is
          not listed, only changes and requests. Times are in UTC.
        </p>
      </div>
      {problem ? <p className="text-sm text-danger">{problem}</p> : null}
      {page.data.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.data.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-text">{auditActionLabel(entry.action)}</span>
                <time dateTime={entry.createdAt.toISOString()} className="text-text-muted">
                  {dateTime.format(entry.createdAt)}
                </time>
              </div>
              <div className="text-text">
                <AuditWhoCell entry={entry} />
              </div>
              {entry.via ? <span className="text-text-muted">{viaLabels[entry.via]}</span> : null}
              <AuditDetails entry={entry} />
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <Link href={older(page.nextCursor)} className={linkClass}>
          Older entries
        </Link>
      ) : null}
    </div>
  );
}
