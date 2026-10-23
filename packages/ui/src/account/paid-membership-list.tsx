"use client";

import { Loader2Icon } from "lucide-react";

import { formatBillingDate } from "../payments/dates";
import { formatMoney } from "../payments/money";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";

export type PaidMembershipBilling =
  { readonly kind: "portal" } | { readonly kind: "direct"; readonly supportContact: string | null };

export interface PaidMembershipItem {
  readonly communitySlug: string;
  readonly communityName: string;
  readonly planName: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly interval: "month" | "year" | null;
  readonly providerStatus: string;
  readonly nextChargeAt: Date | null;
  readonly endsAt: Date | null;
  readonly billing: PaidMembershipBilling;
}

export interface PaidMembershipListProps {
  readonly items: readonly PaidMembershipItem[];
  readonly onManageBilling: (communitySlug: string) => void;
  readonly pendingSlug?: string | null;
  readonly error?: string | null;
}

const statusLabels: Record<string, { label: string; variant: "success" | "warning" | "neutral" }> =
  {
    active: { label: "Active", variant: "success" },
    trialing: { label: "Trial", variant: "success" },
    past_due: { label: "Payment failed", variant: "warning" },
    unpaid: { label: "Unpaid", variant: "warning" },
  };

function price(item: PaidMembershipItem): string | null {
  if (item.amountMinor === null || item.currency === null) return null;
  const amount = formatMoney(item.amountMinor, item.currency);
  return item.interval ? `${amount}/${item.interval}` : amount;
}

function dateLine(item: PaidMembershipItem): string | null {
  if (item.endsAt) return `Ends on ${formatBillingDate(item.endsAt)}`;
  if (item.nextChargeAt) return `Next charge on ${formatBillingDate(item.nextChargeAt)}`;
  return null;
}

function DirectBilling({ item }: { readonly item: PaidMembershipItem }) {
  if (item.billing.kind !== "direct") return null;
  const contact = item.billing.supportContact;
  return (
    <div className="flex flex-col gap-1 text-sm text-text">
      <p className="font-medium">Billed directly by {item.communityName}</p>
      <p className="text-text-muted">
        To change or cancel it, use the link in your Stripe receipt emails
        {contact ? (
          <>
            {" "}
            or contact{" "}
            <a className="text-link" href={`mailto:${contact}`}>
              {contact}
            </a>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}

export function PaidMembershipList({
  items,
  onManageBilling,
  pendingSlug = null,
  error,
}: PaidMembershipListProps) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        You have no paid memberships. When you join a paid community, its billing shows here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {items.map((item) => {
          const status = statusLabels[item.providerStatus] ?? {
            label: item.providerStatus,
            variant: "neutral" as const,
          };
          const amount = price(item);
          const when = dateLine(item);
          const pending = pendingSlug === item.communitySlug;
          return (
            <li key={item.communitySlug} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <a
                    className="truncate text-base font-medium text-text underline-offset-2 hover:underline"
                    href={`/c/${item.communitySlug}`}
                  >
                    {item.communityName}
                  </a>
                  <p className="text-sm text-text-muted">
                    {[item.planName, amount].filter(Boolean).join(", ")}
                  </p>
                  {when ? <p className="text-sm text-text-muted">{when}</p> : null}
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              {item.billing.kind === "portal" ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 self-start"
                  disabled={pendingSlug !== null}
                  aria-busy={pending || undefined}
                  onClick={() => onManageBilling(item.communitySlug)}
                >
                  {pending ? (
                    <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  {pending ? "Opening billing…" : "Manage billing"}
                </Button>
              ) : (
                <DirectBilling item={item} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
