import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
import { Select } from "../primitives/select";
import { formatBillingDate } from "./dates";
import { formatMoney, type BillingInterval } from "./money";

type SubscriberLinkAction = "link_member" | "link_and_add" | "invite" | "skip";

type SubscriberLinkBlock =
  "already_linked" | "invited" | "other_platform" | "no_email" | "banned" | "customer_conflict";

type SubscriberLinkMatch =
  | { kind: "member"; name: string }
  | { kind: "user"; name: string }
  | { kind: "unverified" }
  | { kind: "none" };

interface SubscriberLinkRow {
  id: string;
  email: string | null;
  customerName: string | null;
  status: string;
  unitAmountMinor: number | null;
  currency: string;
  interval: string | null;
  intervalCount: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  match: SubscriberLinkMatch;
  block: SubscriberLinkBlock | null;
  allowed: readonly SubscriberLinkAction[];
}

interface SubscriberLinkChoice {
  action: SubscriberLinkAction;
  interval: BillingInterval | null;
}

interface SubscriberLinkListProps {
  rows: readonly SubscriberLinkRow[];
  choices: Readonly<Record<string, SubscriberLinkChoice>>;
  onChange: (id: string, choice: SubscriberLinkChoice) => void;
  disabled?: boolean;
  locale?: string;
  timeZone?: string;
  className?: string;
}

const actionLabels: Readonly<Record<SubscriberLinkAction, string>> = {
  link_member: "Link to member",
  link_and_add: "Link and add member",
  invite: "Invite by email",
  skip: "Skip",
};

const blockLabels: Readonly<Record<SubscriberLinkBlock, string>> = {
  already_linked: "Already linked",
  invited: "Invited, waiting for sign up",
  other_platform: "Created by another platform. Can't be linked.",
  no_email: "No email on this Stripe customer",
  banned: "This person is banned",
  customer_conflict: "This Stripe customer belongs to another member",
};

const statusLabels: Readonly<Record<string, string>> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
};

function matchText(match: SubscriberLinkMatch): string {
  switch (match.kind) {
    case "member":
      return `Member: ${match.name}`;
    case "user":
      return `Has an account, not a member: ${match.name}`;
    case "unverified":
      return "Has an account with an unverified email";
    case "none":
      return "Not a member yet";
  }
}

function priceText(row: SubscriberLinkRow): string {
  const every =
    row.interval === null
      ? "one time"
      : row.intervalCount === 1
        ? `per ${row.interval}`
        : `every ${row.intervalCount} ${row.interval}s`;
  if (row.unitAmountMinor === null) {
    return `Custom price ${every}`;
  }
  return `${formatMoney(row.unitAmountMinor, row.currency)} ${every}`;
}

function periodText(row: SubscriberLinkRow, locale?: string, timeZone?: string): string | null {
  if (!row.currentPeriodEnd) {
    return null;
  }
  const date = formatBillingDate(row.currentPeriodEnd, locale, timeZone);
  return row.cancelAtPeriodEnd ? `Ends ${date}` : `Renews ${date}`;
}

function SubscriberLinkList({
  rows,
  choices,
  onChange,
  disabled = false,
  locale,
  timeZone,
  className,
}: SubscriberLinkListProps) {
  return (
    <ul data-slot="subscriber-link-list" className={cn("flex flex-col", className)}>
      {rows.map((row) => {
        const choice = choices[row.id] ?? { action: "skip", interval: null };
        const period = periodText(row, locale, timeZone);
        const label = row.email ?? row.customerName ?? row.id;
        const needsInterval = choice.action !== "skip";
        return (
          <li
            key={row.id}
            className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 md:flex-row md:items-start md:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-text" title={label}>
                  {label}
                </span>
                <Badge variant={row.status === "past_due" ? "warning" : "success"}>
                  {statusLabels[row.status] ?? row.status}
                </Badge>
              </div>
              <span className="text-sm text-text-muted">
                {priceText(row)}
                {period ? ` · ${period}` : null}
              </span>
              <span className="text-sm text-text-muted">
                {row.block ? blockLabels[row.block] : matchText(row.match)}
              </span>
            </div>
            {row.block ? null : (
              <div className="grid gap-2 sm:grid-cols-2 md:w-[28rem] md:shrink-0">
                <label className="flex flex-col gap-1 text-sm text-text">
                  Action
                  <Select
                    value={choice.action}
                    disabled={disabled}
                    aria-label={`Action for ${label}`}
                    onChange={(event) => {
                      const action = row.allowed.find((item) => item === event.target.value);
                      if (action) {
                        onChange(row.id, { ...choice, action });
                      }
                    }}
                  >
                    {row.allowed.map((action) => (
                      <option key={action} value={action}>
                        {actionLabels[action]}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-text">
                  Counts as
                  <Select
                    value={choice.interval ?? ""}
                    disabled={disabled || !needsInterval}
                    aria-label={`Membership period for ${label}`}
                    aria-invalid={needsInterval && choice.interval === null ? true : undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      onChange(row.id, {
                        ...choice,
                        interval: value === "month" || value === "year" ? value : null,
                      });
                    }}
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    <option value="month">Monthly membership</option>
                    <option value="year">Yearly membership</option>
                  </Select>
                </label>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export {
  SubscriberLinkList,
  type SubscriberLinkAction,
  type SubscriberLinkBlock,
  type SubscriberLinkChoice,
  type SubscriberLinkListProps,
  type SubscriberLinkMatch,
  type SubscriberLinkRow,
};
