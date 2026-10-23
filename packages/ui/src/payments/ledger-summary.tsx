import { ReceiptIcon } from "lucide-react";

import { EmptyState } from "../community/empty-state";
import { cn } from "../lib/utils";
import { Skeleton } from "../primitives/skeleton";
import type { Edition } from "./fee-copy";
import { formatMoney } from "./money";

interface LedgerCurrencyRow {
  currency: string;
  paymentCount: number;
  grossMinor: number;
  refundedMinor: number;
  netPlatformFeeMinor: number;
}

interface LedgerSummaryProps {
  edition: Edition;
  currencies: readonly LedgerCurrencyRow[];
  providerName?: string;
  locale?: string;
  className?: string;
}

const counts = new Intl.PluralRules("en-US");

function paymentCountLabel(count: number): string {
  return `${new Intl.NumberFormat("en-US").format(count)} ${counts.select(count) === "one" ? "payment" : "payments"}`;
}

function LedgerSummary({
  edition,
  currencies,
  providerName = "Stripe",
  locale,
  className,
}: LedgerSummaryProps) {
  const showFee = edition === "cloud";
  return (
    <div data-slot="ledger-summary" className={cn("flex flex-col gap-4", className)}>
      {currencies.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title="No payments yet"
          description="Totals appear here after the first member pays."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {currencies.map((row) => (
            <li
              key={row.currency}
              aria-label={`${row.currency.toUpperCase()} totals`}
              className="flex flex-col gap-3 rounded-md border border-border p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-text">{row.currency.toUpperCase()}</p>
                <p className="text-sm text-text-muted">{paymentCountLabel(row.paymentCount)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-text-muted">Gross</dt>
                <dd className="text-right text-text tabular-nums">
                  {formatMoney(row.grossMinor, row.currency, locale)}
                </dd>
                {row.refundedMinor > 0 ? (
                  <>
                    <dt className="text-text-muted">Refunded in {providerName}</dt>
                    <dd className="text-right text-text tabular-nums">
                      {formatMoney(row.refundedMinor, row.currency, locale)}
                    </dd>
                  </>
                ) : null}
                {showFee ? (
                  <>
                    <dt className="text-text-muted">Platform fee</dt>
                    <dd className="text-right text-text tabular-nums">
                      {formatMoney(row.netPlatformFeeMinor, row.currency, locale)}
                    </dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-muted">
        {providerName} processing fees are not included. See exact payouts in your {providerName}{" "}
        dashboard.
      </p>
    </div>
  );
}

function LedgerSummarySkeleton() {
  return (
    <div role="status" aria-label="Loading payment totals" className="grid gap-3 sm:grid-cols-2">
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export { LedgerSummary, LedgerSummarySkeleton, type LedgerCurrencyRow, type LedgerSummaryProps };
