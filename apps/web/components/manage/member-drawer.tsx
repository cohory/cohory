"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  formatMoney,
  type ItemAction,
} from "@cohory/ui";
import { formatDate } from "@cohory/ui/lib/format-date";
import Link from "next/link";
import type { ReactNode } from "react";

import type { MemberDetail } from "../../lib/manage/member-detail";
import { accessLabels, personActivityLabel } from "../../lib/manage/people-filters";
import type { PersonRow } from "../../lib/manage/views";

const roleLabels: Record<PersonRow["role"], string> = {
  owner: "Creator",
  admin: "Admin",
  moderator: "Moderator",
  member: "Member",
};

const statusLabels: Record<PersonRow["status"], string> = {
  active: "Active",
  pending: "Waiting for approval",
  removed: "Removed",
  banned: "Banned",
};

function accessLine(row: PersonRow): string | null {
  if (row.access === null) {
    return null;
  }
  const label = accessLabels[row.access];
  if (!row.accessUntil) {
    return label;
  }
  const date = formatDate(row.accessUntil, { timeZone: "UTC" });
  switch (row.access) {
    case "paying_monthly":
    case "paying_yearly":
      return `${label}, renews ${date}`;
    case "cancelling":
      return `${label}, access ends ${date}`;
    case "free_access":
      return `${label} until ${date}`;
    case "past_due":
      return `${label}, period ended ${date}`;
    case "none":
      return label;
    default: {
      const exhaustive: never = row.access;
      return exhaustive;
    }
  }
}

function priceLine(detail: MemberDetail): string | null {
  const billing = detail.billing;
  if (!billing?.paying || billing.amountMinor === null || billing.currency === null) {
    return null;
  }
  return `${formatMoney(billing.amountMinor, billing.currency)} per ${billing.interval ?? "period"}`;
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-text-muted">{term}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export function MemberDrawer({
  slug,
  detail,
  actions,
  showEmail,
  onClose,
}: {
  slug: string;
  detail: MemberDetail | null;
  actions: ItemAction[];
  showEmail: boolean;
  onClose(): void;
}) {
  const row = detail?.row;
  const access = row ? accessLine(row) : null;
  const price = detail ? priceLine(detail) : null;
  const plain = actions.filter((action) => action.variant !== "danger");
  const danger = actions.filter((action) => action.variant === "danger");

  return (
    <Dialog
      open={detail !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel="Close member details"
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 content-start rounded-none border-y-0 border-r-0 sm:max-w-md"
      >
        {row && detail ? (
          <>
            <DialogHeader>
              <DialogTitle>{row.name}</DialogTitle>
              <DialogDescription>
                {[row.username ? `@${row.username}` : null, showEmail ? row.email : null]
                  .filter(Boolean)
                  .join(" · ") || "Member details"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{roleLabels[row.role]}</Badge>
              {row.status !== "active" ? (
                <Badge variant="neutral">{statusLabels[row.status]}</Badge>
              ) : null}
            </div>
            <dl className="flex flex-col gap-3">
              <Fact term="Joined">
                {row.joinedAt ? formatDate(row.joinedAt, { timeZone: "UTC" }) : "Not yet"}
              </Fact>
              <Fact term="Activity">
                <span suppressHydrationWarning>{personActivityLabel(row)}</span>
              </Fact>
              {access ? (
                <Fact term="Access">
                  {access}
                  {price ? <span className="block text-sm text-text-muted">{price}</span> : null}
                </Fact>
              ) : null}
            </dl>
            <section aria-labelledby="member-answers" className="flex flex-col gap-2">
              <h3 id="member-answers" className="text-base font-medium text-text">
                Join answers
              </h3>
              {detail.answers.length > 0 ? (
                <dl className="flex flex-col gap-3 text-sm">
                  {detail.answers.map((answer) => (
                    <div key={answer.question} className="flex flex-col gap-1">
                      <dt className="text-text-muted">{answer.question}</dt>
                      <dd className="whitespace-pre-line break-words text-text">
                        {answer.answer || "No answer"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-text-muted">No join answers.</p>
              )}
            </section>
            <Link href={`/c/${slug}/members/${row.userId}`} className="text-sm text-link">
              View public profile
            </Link>
            {plain.length > 0 || danger.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                {plain.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {plain.map((action) => (
                      <Button
                        key={action.id}
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        onClick={action.onSelect}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {danger.length > 0 ? (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {danger.map((action) => (
                      <Button
                        key={action.id}
                        type="button"
                        variant="danger"
                        className="min-h-11"
                        onClick={action.onSelect}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
