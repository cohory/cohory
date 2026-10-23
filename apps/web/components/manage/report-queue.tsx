"use client";

import { Badge, Button, RelativeTime, toast } from "@cohory/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { memberBillingAction } from "../../lib/manage/actions";
import { removalDescription } from "../../lib/manage/people-billing";
import { moderateReportAction } from "../../lib/moderation/actions";
import type { ReportRow } from "../../lib/manage/views";
import { reportReasonLabels, reportStatusLabels } from "../../lib/moderation/labels";
import { ConfirmDialog } from "./confirm-dialog";

type Decision = "delete" | "ban";

const banText =
  "They lose access right away and can't rejoin with the same account or email. Their posts stay until you delete them.";

function ReportItem({ slug, row }: { slug: string; row: ReportRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [banDescription, setBanDescription] = useState(banText);
  const noun = row.type === "comment" ? "comment" : "post";
  const open = row.status === "open";
  const closedLabel = row.status === "open" ? null : reportStatusLabels[row.status];

  function act(decision: "dismiss" | Decision) {
    return moderateReportAction({ slug, type: row.type, id: row.id, decision });
  }

  function dismiss() {
    startTransition(async () => {
      const result = await act("dismiss");
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Report dismissed.");
      router.refresh();
    });
  }

  function confirmBan() {
    startTransition(async () => {
      const billing = await memberBillingAction({ slug, userId: row.authorId });
      if (!billing.ok) {
        toast.error(billing.message);
        return;
      }
      setBanDescription(removalDescription(row.authorName, billing.data, banText));
      setConfirming("ban");
    });
  }

  return (
    <li
      aria-label={`Reported ${noun} by ${row.authorName}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-text">
          {row.reportCount === 1 ? "1 report" : `${row.reportCount} reports`} on a {noun} by{" "}
          {row.authorName}
        </p>
        <p className="text-sm text-text-muted">
          {open ? "Last reported " : `${closedLabel ?? ""} `}
          <RelativeTime
            value={open ? row.lastReportedAt : (row.resolvedAt ?? row.lastReportedAt)}
          />
          {!open && row.resolvedBy ? ` by ${row.resolvedBy}` : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.reasons.map((reason) => (
          <Badge key={reason} variant="neutral">
            {reportReasonLabels[reason]}
          </Badge>
        ))}
        {row.deleted ? <Badge variant="neutral">Already deleted</Badge> : null}
      </div>
      <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-line break-words text-text">
        {row.postTitle && row.type === "post" ? (
          <span className="block font-medium">{row.postTitle}</span>
        ) : null}
        {row.excerpt || "No text"}
      </blockquote>
      {row.notes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {row.notes.map((note, index) => (
            <li key={index}>&ldquo;{note}&rdquo;</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/c/${slug}/posts/${row.postId}`}
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open the post
        </Link>
        {open ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={dismiss}
            >
              Dismiss
            </Button>
            {row.deleted ? null : (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={pending}
                onClick={() => setConfirming("delete")}
              >
                Delete {noun}
              </Button>
            )}
            {row.canBan ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={pending}
                onClick={confirmBan}
              >
                Ban {row.authorName}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => (next ? undefined : setConfirming(null))}
        title={confirming === "ban" ? `Ban ${row.authorName}?` : `Delete this ${noun}?`}
        description={
          confirming === "ban"
            ? banDescription
            : `The ${noun} will no longer be visible to members. The reports are closed.`
        }
        confirmLabel={confirming === "ban" ? "Ban member" : `Delete ${noun}`}
        pendingLabel={confirming === "ban" ? "Banning…" : "Deleting…"}
        danger
        onConfirm={() => act(confirming ?? "delete")}
        onDone={() => {
          toast.success(confirming === "ban" ? `${row.authorName} is banned.` : "Deleted.");
          setConfirming(null);
          router.refresh();
        }}
      />
    </li>
  );
}

export function ReportQueue({
  slug,
  status,
  openCount,
  rows,
}: {
  slug: string;
  status: "open" | "closed";
  openCount: number;
  rows: readonly ReportRow[];
}) {
  const base = `/c/${slug}/manage/inbox?tab=reports`;
  const linkClass =
    "inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Report status" className="flex gap-2">
        <Link
          href={base}
          aria-current={status === "open" ? "page" : undefined}
          className={`${linkClass} ${status === "open" ? "text-text underline" : "text-text-muted"}`}
        >
          Open ({openCount})
        </Link>
        <Link
          href={`${base}&reports=closed`}
          aria-current={status === "closed" ? "page" : undefined}
          className={`${linkClass} ${status === "closed" ? "text-text underline" : "text-text-muted"}`}
        >
          Resolved
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">
          {status === "open" ? "Nothing is waiting for review." : "No resolved reports yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <ReportItem
              key={`${row.type}:${row.id}:${row.resolvedAt ?? ""}`}
              slug={slug}
              row={row}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
