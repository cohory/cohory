import { getAgentsService } from "@cohory/agents";
import { can } from "@cohory/authz";
import { CommunityValidationError, getManageService, type AuditLogPage } from "@cohory/communities";
import { Alert, AlertDescription, Button, Input, Label } from "@cohory/ui";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  AuditDetails,
  AuditTargetCell,
  AuditWhoCell,
} from "../../../../../../components/manage/audit-row";
import {
  actorTypeLabels,
  auditActionLabel,
  auditFiltersFrom,
  auditQuery,
  auditTarget,
  viaLabels,
} from "../../../../../../lib/manage/audit";
import { requireManagePage } from "../../../../../../lib/manage/load";

export const metadata: Metadata = { title: "Audit log" };

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export default async function AuditLogPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/settings/audit-log">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const query = await searchParams;
  const filters = auditFiltersFrom(query);
  const activeFilters = auditFiltersFrom({ ...query, cursor: undefined });
  const canExport = can(manage.actor, "export", "audit_log", { role: manage.role });
  let page: AuditLogPage = { data: [], nextCursor: null, actions: [] };
  let problem: string | null = null;
  const agents = await getAgentsService().listAgents(manage.actor, manage.communityId);
  const tokens = agents.flatMap((agent) =>
    agent.tokens.map((token) => ({ id: token.id, label: `${agent.name}: ${token.name}` })),
  );
  try {
    page = await getManageService().listAuditLog(manage.actor, manage.communityId, filters);
  } catch (error) {
    if (!(error instanceof CommunityValidationError)) throw error;
    problem = error.issues[0]?.message ?? "Check the filters and try again.";
  }
  const base = `/c/${manage.slug}/manage/settings/audit-log`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold text-text">Audit log</h3>
        {canExport ? (
          <Button asChild variant="secondary" className="min-h-11">
            <a
              href={`/api/v1/communities/${manage.slug}/manage/audit-log.csv${auditQuery(activeFilters)}`}
              download
            >
              <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
              Download CSV
            </a>
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-text-muted">
        Every admin action in this community: role changes, bans, invites, join decisions, settings,
        exports, payments, reports, point resets, comped access, and everything done with API tokens
        and agents. Times are in UTC.
      </p>
      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-action">Action</Label>
          <select
            id="audit-action"
            name="action"
            defaultValue={filters.action ?? ""}
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All actions</option>
            {page.actions.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-actor-type">Who</Label>
          <select
            id="audit-actor-type"
            name="actorType"
            defaultValue={filters.actorType ?? ""}
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Everyone</option>
            {Object.entries(actorTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {agents.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="audit-agent">Agent</Label>
            <select
              id="audit-agent"
              name="agentId"
              defaultValue={filters.agentId ?? ""}
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Any agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {tokens.length > 0 || filters.tokenId ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="audit-token">Token</Label>
            <select
              id="audit-token"
              name="tokenId"
              defaultValue={filters.tokenId ?? ""}
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Any token</option>
              {filters.tokenId && !tokens.some((token) => token.id === filters.tokenId) ? (
                <option value={filters.tokenId}>Chosen token</option>
              ) : null}
              {tokens.map((token) => (
                <option key={token.id} value={token.id}>
                  {token.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-via">How</Label>
          <select
            id="audit-via"
            name="via"
            defaultValue={filters.via ?? ""}
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Any way</option>
            {Object.entries(viaLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            className="min-h-11"
          />
        </div>
        <Button type="submit" variant="secondary" className="min-h-11">
          Filter
        </Button>
        {Object.keys(activeFilters).length > 0 ? (
          <Link href={base} className={linkClass}>
            Clear filters
          </Link>
        ) : null}
      </form>
      {problem ? (
        <Alert variant="danger">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
      {page.data.length === 0 ? (
        <p className="text-sm text-text-muted">No entries match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-surface-raised text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Who
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Target
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((entry) => (
                <tr key={entry.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    <time dateTime={entry.createdAt.toISOString()}>
                      {dateTime.format(entry.createdAt)}
                    </time>
                  </td>
                  <td className="px-3 py-2 text-text">
                    <AuditWhoCell entry={entry} />
                    {entry.via ? (
                      <span className="block text-xs text-text-muted">{viaLabels[entry.via]}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-text">{auditActionLabel(entry.action)}</td>
                  <td className="px-3 py-2 break-words text-text">
                    <AuditTargetCell target={auditTarget(entry, manage.slug)} />
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    <AuditDetails entry={entry} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`${base}${auditQuery(activeFilters, { cursor: page.nextCursor })}`}
          className={`${linkClass} self-start`}
        >
          Older entries
        </Link>
      ) : null}
    </>
  );
}
