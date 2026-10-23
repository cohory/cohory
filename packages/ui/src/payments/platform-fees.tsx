import { ExternalLinkIcon, ReceiptIcon } from "lucide-react";

import { EmptyState } from "../community/empty-state";
import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
import { Skeleton } from "../primitives/skeleton";
import { formatBillingDate } from "./dates";
import { formatFeeRate, formatMoney } from "./money";

type PlatformInvoiceStatus = "draft" | "open" | "past_due" | "paid" | "void" | "uncollectible";

interface PlatformFeeBalance {
  currency: string;
  currentMinor: number;
  carriedMinor: number;
  minimumMinor: number;
}

interface PlatformInvoiceRow {
  id: string;
  currency: string;
  periodStart: Date;
  amountMinor: number;
  status: PlatformInvoiceStatus;
  number: string | null;
  hostedInvoiceUrl: string | null;
  dueAt: Date | null;
  paidAt: Date | null;
}

interface PlatformFeeBalancesProps {
  balances: readonly PlatformFeeBalance[];
  nextInvoiceAt: Date;
  feeBps: number;
  locale?: string;
  className?: string;
}

interface PlatformInvoiceTableProps {
  rows: readonly PlatformInvoiceRow[];
  locale?: string;
  className?: string;
}

function platformFeesIntro(feeBps: number): string {
  return `Stripe Connect collects the ${formatFeeRate(feeBps)} platform fee when each payment is made, so those fees never show up here. Payment providers that can't split the fee are billed once a month instead.`;
}

function periodLabel(start: Date, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(start);
}

function PlatformFeeBalances({
  balances,
  nextInvoiceAt,
  feeBps,
  locale,
  className,
}: PlatformFeeBalancesProps) {
  const next = formatBillingDate(nextInvoiceAt, locale);
  const carried = balances.filter((row) => row.carriedMinor !== 0);
  return (
    <div data-slot="platform-fee-balances" className={cn("flex flex-col gap-4", className)}>
      <p className="text-sm text-text-muted">{platformFeesIntro(feeBps)}</p>
      {balances.length === 0 ? (
        <p className="text-sm text-text">
          Nothing to bill this month. The next invoice date is {next}.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {balances.map((row) => (
            <li
              key={row.currency}
              aria-label={`${row.currency.toUpperCase()} platform fees`}
              className="flex flex-col gap-2 rounded-md border border-border p-4"
            >
              <p className="text-sm font-medium text-text">{row.currency.toUpperCase()}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-text-muted">This month so far</dt>
                <dd className="text-right text-text tabular-nums">
                  {formatMoney(row.currentMinor, row.currency, locale)}
                </dd>
                {row.carriedMinor !== 0 ? (
                  <>
                    <dt className="text-text-muted">Carried forward</dt>
                    <dd className="text-right text-text tabular-nums">
                      {formatMoney(row.carriedMinor, row.currency, locale)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-text-muted">Next invoice</dt>
                <dd className="text-right text-text">{next}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {carried.map((row) => (
        <p key={row.currency} className="text-sm text-text-muted">
          {formatMoney(row.carriedMinor, row.currency, locale)} from earlier months is below the{" "}
          {formatMoney(row.minimumMinor, row.currency, locale)} minimum, so it carries forward to
          the next invoice.
        </p>
      ))}
    </div>
  );
}

const statusBadges: Record<
  PlatformInvoiceStatus,
  { label: string; variant: "success" | "warning" | "neutral" }
> = {
  draft: { label: "Preparing", variant: "neutral" },
  open: { label: "Due", variant: "neutral" },
  past_due: { label: "Past due", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Canceled", variant: "neutral" },
  uncollectible: { label: "Unpaid", variant: "warning" },
};

function detail(row: PlatformInvoiceRow, locale?: string): string {
  if (row.status === "paid" && row.paidAt) {
    return `Paid ${formatBillingDate(row.paidAt, locale)}`;
  }
  if ((row.status === "open" || row.status === "past_due") && row.dueAt) {
    return `Due ${formatBillingDate(row.dueAt, locale)}`;
  }
  return row.number ?? "";
}

function PlatformInvoiceTable({ rows, locale, className }: PlatformInvoiceTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptIcon />}
        title="No invoices yet"
        description="Your first invoice appears here after a month with platform fees to bill."
        className={className}
      />
    );
  }
  return (
    <div data-slot="platform-invoice-table" className={cn("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Platform fee invoices</caption>
        <thead className="text-text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">
              Month
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Status
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Invoice</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = statusBadges[row.status];
            const month = periodLabel(row.periodStart, locale);
            return (
              <tr key={row.id} className="border-b border-border last:border-b-0">
                <td className="py-3 pr-4 align-top text-text">
                  {month}
                  <p className="text-text-muted">{detail(row, locale)}</p>
                </td>
                <td className="py-3 pr-4 text-right align-top text-text tabular-nums">
                  {formatMoney(row.amountMinor, row.currency, locale)}
                </td>
                <td className="py-3 pr-4 align-top">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="py-3 align-top">
                  {row.hostedInvoiceUrl ? (
                    <a
                      href={row.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${row.status === "open" || row.status === "past_due" ? "Pay" : "View"} the ${month} invoice (opens Stripe)`}
                      className="inline-flex min-h-11 items-center gap-1 text-accent underline-offset-4 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      {row.status === "open" || row.status === "past_due" ? "Pay" : "View"}
                      <ExternalLinkIcon aria-hidden className="size-3.5" />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlatformFeesSkeleton() {
  return (
    <div role="status" aria-label="Loading platform fees" className="grid gap-3 sm:grid-cols-2">
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export {
  PlatformFeeBalances,
  PlatformFeesSkeleton,
  PlatformInvoiceTable,
  platformFeesIntro,
  type PlatformFeeBalance,
  type PlatformFeeBalancesProps,
  type PlatformInvoiceRow,
  type PlatformInvoiceStatus,
  type PlatformInvoiceTableProps,
};
