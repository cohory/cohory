import { can } from "@cohory/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@cohory/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { loadInboxCounts } from "../../../lib/manage/inbox";
import {
  loadRevenueMetrics,
  needsYouItems,
  type OverviewViewer,
} from "../../../lib/manage/overview";

async function countsFor({ actor, role, communityId }: OverviewViewer) {
  const [inbox, failedPayments] = await Promise.all([
    loadInboxCounts(actor, role, communityId),
    can(actor, "read", "payment", { role })
      ? loadRevenueMetrics(actor, communityId).then((metrics) => metrics.pastDueCount)
      : 0,
  ]);
  return {
    joinRequests: inbox.requests ?? 0,
    reports: inbox.reports ?? 0,
    failedPayments,
    agentRequests: inbox.approvals ?? 0,
  };
}

export async function NeedsYouCard({ viewer }: { viewer: OverviewViewer }) {
  const items = needsYouItems(await countsFor(viewer), viewer.slug);
  if (items.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Needs you</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center justify-between gap-2 rounded-sm py-2 text-sm font-medium text-text outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
                <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
