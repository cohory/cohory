import type { Actor } from "@cohory/authz";
import { getPaymentsService, type RevenueMetrics } from "@cohory/payments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, formatMoney } from "@cohory/ui";
import { formatCount } from "@cohory/ui/lib/format-number";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { MetricTile } from "../manage/overview/metric-tile";
import {
  loadPaymentsOverview,
  loadRevenueMetrics,
  trendOf,
  type TrendView,
} from "../../lib/manage/overview";
import { connectionReady } from "../../lib/payments/views";

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly trend: TrendView | null;
}

function moneyTiles(metrics: RevenueMetrics): Tile[] {
  const counts = (current: number, previous: number) => trendOf(current, previous, "last month");
  const tiles: Tile[] = [];
  const currency = metrics.currency;
  if (currency) {
    const money = (value: number) => formatMoney(value, currency);
    tiles.push(
      {
        label: "Monthly recurring revenue",
        value: money(metrics.mrrMinor.current),
        trend: trendOf(
          metrics.mrrMinor.current,
          metrics.mrrMinor.previous,
          "the start of the month",
          money,
        ),
      },
      {
        label: "Revenue this month",
        value: money(metrics.revenueMinor.current),
        trend: trendOf(
          metrics.revenueMinor.current,
          metrics.revenueMinor.previous,
          "last month",
          money,
        ),
      },
    );
  }
  tiles.push(
    {
      label: "New paid members this month",
      value: formatCount(metrics.newPaid.current),
      trend: counts(metrics.newPaid.current, metrics.newPaid.previous),
    },
    {
      label: "Cancellations this month",
      value: formatCount(metrics.cancellations.current),
      trend: counts(metrics.cancellations.current, metrics.cancellations.previous),
    },
    { label: "Past due", value: formatCount(metrics.pastDueCount), trend: null },
  );
  return tiles;
}

export async function PaymentsOverviewCard({
  actor,
  communityId,
  slug,
}: {
  actor: Actor;
  communityId: string;
  slug: string;
}) {
  const [overview, plan, metrics] = await Promise.all([
    loadPaymentsOverview(actor, communityId),
    getPaymentsService().getPlan(actor, communityId),
    loadRevenueMetrics(actor, communityId),
  ]);
  const connection = overview.connection;
  const description = !connection
    ? "Connect your Stripe account to sell memberships."
    : !connectionReady(connection)
      ? "Stripe needs more information before you can take payments."
      : plan
        ? `${formatMoney(plan.monthlyPriceMinor, plan.currency)} per month.`
        : "Stripe is connected. Your community is free to join.";
  const showNumbers = connection !== null || metrics.everPaid;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Money</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connection && !connection.livemode ? (
          <p className="rounded-md bg-info-muted px-3 py-2 text-sm text-text">
            Test mode. No real money moves, so these numbers come from test purchases.
          </p>
        ) : null}
        {showNumbers ? (
          <>
            <p className="text-sm text-text">
              Paying members:{" "}
              <span className="font-semibold tabular-nums">{formatCount(metrics.payingCount)}</span>
              {metrics.cancellingCount > 0
                ? `, ${formatCount(metrics.cancellingCount)} cancelling at the end of their period`
                : null}
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {moneyTiles(metrics).map((tile) => (
                <li key={tile.label}>
                  <MetricTile label={tile.label} value={tile.value} trend={tile.trend} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <Link
          href={`/c/${slug}/manage/payments`}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {connection ? "Open payments" : "Set up payments"}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
