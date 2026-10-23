"use client";

import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "../community/empty-state";
import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
import { Skeleton } from "../primitives/skeleton";
import { formatBillingDate } from "./dates";
import { Button } from "../primitives/button";
import { formatMoney, intervalNoun, type BillingInterval } from "./money";

interface SubscriptionRow {
  id: string;
  memberName: string;
  memberEmail: string;
  providerStatus: string;
  interval: BillingInterval | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  endedAt: Date | null;
  amountMinor: number | null;
  currency: string | null;
  dashboardUrl: string | null;
}

interface SubscriptionTableProps {
  rows: readonly SubscriptionRow[];
  locale?: string;
  timeZone?: string;
  className?: string;
}

const statusLabels: Readonly<Record<string, string>> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  unpaid: "Unpaid",
  canceled: "Canceled",
  paused: "Paused",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
};

function statusBadge(row: SubscriptionRow) {
  const label = statusLabels[row.providerStatus] ?? row.providerStatus;
  if (row.providerStatus === "past_due" || row.providerStatus === "unpaid") {
    return <Badge variant="warning">{label}</Badge>;
  }
  if (row.providerStatus === "active" || row.providerStatus === "trialing") {
    return <Badge variant="success">{row.cancelAtPeriodEnd ? "Canceling" : label}</Badge>;
  }
  return <Badge variant="neutral">{label}</Badge>;
}

type StatusFilter = "all" | "active" | "past_due" | "canceling" | "ended";

const filterLabels: Readonly<Record<StatusFilter, string>> = {
  all: "All",
  active: "Active",
  past_due: "Past due",
  canceling: "Canceling",
  ended: "Ended",
};

const filters = Object.keys(filterLabels) as StatusFilter[];

function statusGroup(row: SubscriptionRow): Exclude<StatusFilter, "all"> | null {
  if (
    row.endedAt ||
    row.providerStatus === "canceled" ||
    row.providerStatus === "incomplete_expired"
  ) {
    return "ended";
  }
  if (row.providerStatus === "past_due" || row.providerStatus === "unpaid") {
    return "past_due";
  }
  if (row.providerStatus === "active" || row.providerStatus === "trialing") {
    return row.cancelAtPeriodEnd ? "canceling" : "active";
  }
  return null;
}

function matches(row: SubscriptionRow, filter: StatusFilter): boolean {
  return filter === "all" || statusGroup(row) === filter;
}

function amountText(row: SubscriptionRow): string {
  if (row.amountMinor === null || row.currency === null || row.interval === null) {
    return row.interval === "year" ? "Yearly" : row.interval === "month" ? "Monthly" : "None";
  }
  return `${formatMoney(row.amountMinor, row.currency)} a ${intervalNoun(row.interval)}`;
}

function periodText(row: SubscriptionRow, locale?: string, timeZone?: string): string {
  if (row.endedAt) {
    return `Ended ${formatBillingDate(row.endedAt, locale, timeZone)}`;
  }
  if (!row.currentPeriodEnd) {
    return "Not started";
  }
  const date = formatBillingDate(row.currentPeriodEnd, locale, timeZone);
  return row.cancelAtPeriodEnd ? `Ends ${date}` : `Renews ${date}`;
}

function SubscriptionTable({ rows, locale, timeZone, className }: SubscriptionTableProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CreditCardIcon />}
        title="No paid members yet"
        description="When someone buys a membership, they show up here."
        className={className}
      />
    );
  }
  const shown = rows.filter((row) => matches(row, filter));
  return (
    <div data-slot="subscription-table" className={cn("flex flex-col gap-3", className)}>
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {filters.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={filter === option ? "secondary" : "ghost"}
            aria-pressed={filter === option}
            className="min-h-11 tabular-nums"
            onClick={() => setFilter(option)}
          >
            {`${filterLabels[option]} (${rows.filter((row) => matches(row, option)).length})`}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Paid memberships</caption>
          <thead className="text-text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 font-medium">
                Member
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">
                Plan price
              </th>
              <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">
                Period
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const period = periodText(row, locale, timeZone);
              return (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="max-w-40 py-3 pr-4 align-top sm:max-w-48">
                    <p className="truncate font-medium text-text" title={row.memberName}>
                      {row.memberName}
                    </p>
                    <p className="truncate text-text-muted" title={row.memberEmail}>
                      {row.memberEmail}
                    </p>
                  </td>
                  <td className="py-3 align-top sm:pr-4">
                    {statusBadge(row)}
                    <p data-slot="subscription-period-stacked" className="mt-1 text-text sm:hidden">
                      {period}
                    </p>
                  </td>
                  <td className="hidden py-3 pr-4 align-top text-text sm:table-cell">
                    {amountText(row)}
                  </td>
                  <td className="hidden py-3 pr-4 align-top text-text sm:table-cell">{period}</td>
                  <td className="py-3 align-top">
                    {row.dashboardUrl ? (
                      <a
                        href={row.dashboardUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-accent underline-offset-4 hover:underline"
                      >
                        Open in Stripe
                        <span className="sr-only">: {row.memberName}</span>
                        <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubscriptionTableSkeleton() {
  return (
    <div role="status" aria-label="Loading paid memberships" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export {
  SubscriptionTable,
  SubscriptionTableSkeleton,
  type SubscriptionRow,
  type SubscriptionTableProps,
};
