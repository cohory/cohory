import { can } from "@cohory/authz";
import { getManageService, type CommunityHealth } from "@cohory/communities";
import { inactivePayingDays } from "@cohory/payments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import { formatCount } from "@cohory/ui/lib/format-number";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { loadRevenueMetrics, trendOf, type OverviewViewer } from "../../../lib/manage/overview";
import { peopleHref } from "../../../lib/manage/people-filters";
import { MetricTile } from "./metric-tile";

const linkClass =
  "flex min-h-11 items-center justify-between gap-2 rounded-sm py-2 text-sm font-medium text-text outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring";

function healthTiles(health: CommunityHealth) {
  const week = (current: number, previous: number) => trendOf(current, previous, "last week");
  return [
    {
      label: "Members",
      value: formatCount(health.members.current),
      trend: trendOf(health.members.current, health.members.previous, "a week ago"),
    },
    {
      label: "New this week",
      value: formatCount(health.newMembers.current),
      trend: week(health.newMembers.current, health.newMembers.previous),
    },
    {
      label: "Active in 7 days",
      value: formatCount(health.activeMembers7d),
      detail: `${formatCount(health.activeMembers30d)} active in 30 days`,
    },
    {
      label: "Posts this week",
      value: formatCount(health.posts.current),
      trend: week(health.posts.current, health.posts.previous),
    },
    {
      label: "Comments this week",
      value: formatCount(health.comments.current),
      trend: week(health.comments.current, health.comments.previous),
    },
    {
      label: "Lessons completed this week",
      value: formatCount(health.lessonsCompleted.current),
      trend: week(health.lessonsCompleted.current, health.lessonsCompleted.previous),
    },
  ];
}

export async function HealthCard({ viewer }: { viewer: OverviewViewer }) {
  const { actor, role, communityId, slug } = viewer;
  const [health, metrics] = await Promise.all([
    getManageService().getCommunityHealth(actor, communityId),
    can(actor, "read", "payment", { role })
      ? loadRevenueMetrics(actor, communityId)
      : Promise.resolve(null),
  ]);
  const signals = [
    health.newNotGreeted > 0
      ? {
          key: "greet",
          label: `New this week, not yet greeted: ${formatCount(health.newNotGreeted)}`,
          href: peopleHref(slug, { role: "member" }),
        }
      : null,
    metrics && metrics.payingInactiveCount > 0
      ? {
          key: "inactive",
          label: `Paid members inactive for ${inactivePayingDays} days: ${formatCount(metrics.payingInactiveCount)}`,
          href: peopleHref(slug, {
            role: "member",
            inactiveDays: inactivePayingDays,
            paid: true,
          }),
        }
      : null,
  ].filter((signal) => signal !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Community health</CardTitle>
        <CardDescription>Members only. You and your team are not counted.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {healthTiles(health).map((tile) => (
            <li key={tile.label}>
              <MetricTile {...tile} />
            </li>
          ))}
        </ul>
        {health.topPost ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-text-muted">Top post this week</p>
            <Link
              href={`/c/${encodeURIComponent(slug)}/posts/${health.topPost.id}`}
              className="rounded-sm font-medium text-text underline-offset-4 outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {health.topPost.title ?? health.topPost.excerpt}
            </Link>
            <p className="text-text-muted">
              {formatCount(health.topPost.likeCount)}{" "}
              {health.topPost.likeCount === 1 ? "like" : "likes"},{" "}
              {formatCount(health.topPost.commentCount)}{" "}
              {health.topPost.commentCount === 1 ? "comment" : "comments"}
            </p>
          </div>
        ) : null}
        {signals.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {signals.map((signal) => (
              <li key={signal.key}>
                <Link href={signal.href} className={linkClass}>
                  {signal.label}
                  <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
