import { getPostsService } from "@cohory/api/services";
import { getApprovalsService } from "@cohory/agents/approvals";
import { canExecuteApproval } from "@cohory/api";
import { can } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { getReviewsService } from "@cohory/reviews";
import { TabsContent, TabsList, TabsTrigger } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";

import {
  ApprovalHistory,
  PendingApprovals,
  type RecentAgentActions,
} from "../../../../../components/manage/approval-queue";
import { JoinRequests } from "../../../../../components/manage/join-requests";
import { ReportQueue } from "../../../../../components/manage/report-queue";
import { ReviewReportQueue } from "../../../../../components/manage/review-report-queue";
import { UrlTabs } from "../../../../../components/manage/url-tabs";
import { toApprovalRow } from "../../../../../lib/manage/approvals";
import { approvalLifecycleActions, auditActionLabel } from "../../../../../lib/manage/audit";
import {
  inboxTabLabels,
  inboxTabsFor,
  loadInboxCounts,
  openInboxTab,
} from "../../../../../lib/manage/inbox";
import { requireManagePage, type ManagePage } from "../../../../../lib/manage/load";
import { toReportRow } from "../../../../../lib/manage/views";
import { toReviewReportRows } from "../../../../../lib/reviews/views";

export const metadata: Metadata = { title: "Inbox" };

async function RequestsPanel({ manage }: { manage: ManagePage }) {
  const requests = await getManageService().listJoinRequests(manage.actor, manage.communityId);
  return (
    <JoinRequests
      slug={manage.slug}
      pendingCount={requests.pendingCount}
      requests={requests.data.map((request) => ({
        id: request.id,
        name: request.name,
        username: request.username,
        email: request.email,
        createdAt: request.createdAt.toISOString(),
        answers: request.answers.map((answer) => ({ ...answer })),
      }))}
    />
  );
}

async function ReportsPanel({ manage, status }: { manage: ManagePage; status: "open" | "closed" }) {
  const viewer = { actor: manage.actor, role: manage.role };
  const [reports, reviewReports] = await Promise.all([
    getPostsService().listReports(manage.actor, manage.communityId, { status }),
    getReviewsService().listReviewReports(manage.actor, manage.communityId, { status }),
  ]);
  return (
    <>
      <ReportQueue
        slug={manage.slug}
        status={status}
        openCount={reports.openCount + reviewReports.openCount}
        rows={reports.data.map((group) => toReportRow(viewer, group))}
      />
      <ReviewReportQueue
        slug={manage.slug}
        rows={toReviewReportRows(reviewReports)}
        canHide={can(manage.actor, "hide", "review", { role: manage.role })}
      />
    </>
  );
}

const recentActionCount = 3;

async function recentAgentActions(
  manage: ManagePage,
  agentIds: readonly string[],
): Promise<RecentAgentActions> {
  if (!can(manage.actor, "read", "audit_log", { role: manage.role })) {
    return {};
  }
  const entries = await Promise.all(
    [...new Set(agentIds)].map(async (agentId) => {
      const page = await getManageService().listAuditLog(manage.actor, manage.communityId, {
        agentId,
        excludeActions: [...approvalLifecycleActions],
        limit: recentActionCount,
      });
      const items = page.data.map((entry) => ({
        id: entry.id,
        label: auditActionLabel(entry.action),
        at: entry.createdAt.toISOString(),
      }));
      return [agentId, items] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function ApprovalsPanel({ manage, view }: { manage: ManagePage; view: string }) {
  const service = getApprovalsService();
  const [pending, history] = await Promise.all([
    service.list(manage.actor, manage.communityId, "pending"),
    service.list(manage.actor, manage.communityId, "history"),
  ]);
  const row = (approval: (typeof pending)[number]) =>
    toApprovalRow(approval, canExecuteApproval(approval.operationId));
  const recent = await recentAgentActions(
    manage,
    pending.map((approval) => approval.agent.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Agents ask here before they remove or ban people, change roles, touch money, delete or
        publish content, or export data. Approving runs the request once, as you, with your
        permissions. Requests expire after 72 hours. Everything is in the{" "}
        <Link
          href={`/c/${manage.slug}/manage/settings/audit-log?actorType=agent`}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          audit log
        </Link>
        .
      </p>
      <UrlTabs param="view" defaultValue={view === "history" ? "history" : "pending"}>
        <TabsList aria-label="Agent approvals">
          <TabsTrigger value="pending" className="min-h-11">
            Waiting ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-11">
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="pt-4">
          <PendingApprovals slug={manage.slug} rows={pending.map(row)} recent={recent} />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <ApprovalHistory rows={history.map(row)} />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}

export default async function ManageInboxPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/inbox">) {
  const query = await searchParams;
  const manage = await requireManagePage((await params).slug, "inbox", query);
  const tabs = inboxTabsFor(manage);
  const counts = await loadInboxCounts(manage.actor, manage.role, manage.communityId);
  const tab = openInboxTab(tabs, counts, query.tab);

  return (
    <>
      <h2 className="text-2xl font-semibold text-text">Inbox</h2>
      {tab ? (
        <UrlTabs param="tab" defaultValue={tab}>
          <TabsList aria-label="Inbox" className="max-w-full flex-wrap">
            {tabs.map((item) => (
              <TabsTrigger key={item} value={item} className="min-h-11">
                {inboxTabLabels[item]}
                {counts[item] === undefined ? null : ` (${counts[item]})`}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.includes("requests") ? (
            <TabsContent value="requests">
              <RequestsPanel manage={manage} />
            </TabsContent>
          ) : null}
          {tabs.includes("reports") ? (
            <TabsContent value="reports">
              <ReportsPanel
                manage={manage}
                status={query.reports === "closed" ? "closed" : "open"}
              />
            </TabsContent>
          ) : null}
          {tabs.includes("approvals") ? (
            <TabsContent value="approvals">
              <ApprovalsPanel manage={manage} view={query.view === "history" ? "history" : ""} />
            </TabsContent>
          ) : null}
        </UrlTabs>
      ) : null}
    </>
  );
}
