"use client";

import { Badge, Button, RelativeTime, Select, toast } from "@cohory/ui";
import type { ReportReason, ReviewHiddenReason } from "@cohory/db/schema";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { reportReasonLabels } from "../../lib/moderation/labels";
import { dismissReviewReportsAction, hideReviewAction } from "../../lib/reviews/actions";
import {
  hiddenReasonLabels,
  hiddenReasonOrder,
  type ReviewReportRow,
} from "../../lib/reviews/views";

function isReportReason(value: string): value is ReportReason {
  return value in reportReasonLabels;
}

function ReviewReportItem({
  slug,
  row,
  canHide,
}: {
  slug: string;
  row: ReviewReportRow;
  canHide: boolean;
}) {
  const router = useRouter();
  const selectId = useId();
  const [reason, setReason] = useState<ReviewHiddenReason>("spam");
  const [pending, startTransition] = useTransition();
  const open = row.status === "open";

  function act(kind: "hide" | "dismiss") {
    startTransition(async () => {
      const result =
        kind === "hide"
          ? await hideReviewAction({ slug, reviewId: row.reviewId, reason })
          : await dismissReviewReportsAction({ slug, reviewId: row.reviewId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(kind === "hide" ? "Review hidden." : "Report dismissed.");
      router.refresh();
    });
  }

  return (
    <li
      aria-label={`Reported review by ${row.authorName}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-text">
          {row.reportCount === 1 ? "1 report" : `${row.reportCount} reports`} on a{" "}
          {row.rating === 1 ? "1 star" : `${row.rating} star`} review by {row.authorName}
        </p>
        <p className="text-sm text-text-muted">
          {open ? "Last reported " : row.status === "hidden" ? "Hidden " : "Dismissed "}
          <RelativeTime value={row.lastReportedAt} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.reasons.filter(isReportReason).map((value) => (
          <Badge key={value} variant="neutral">
            {reportReasonLabels[value]}
          </Badge>
        ))}
        {row.hiddenReason ? (
          <Badge variant="neutral">Hidden for {hiddenReasonLabels[row.hiddenReason]}</Badge>
        ) : null}
      </div>
      <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-line break-words text-text">
        {row.excerpt}
      </blockquote>
      {row.notes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {row.notes.map((note, index) => (
            <li key={index}>&ldquo;{note}&rdquo;</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          {canHide ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={selectId} className="text-sm font-medium text-text">
                  Reason to hide
                </label>
                <Select
                  id={selectId}
                  value={reason}
                  onChange={(event) => {
                    const next = hiddenReasonOrder.find((value) => value === event.target.value);
                    if (next) setReason(next);
                  }}
                >
                  {hiddenReasonOrder.map((value) => (
                    <option key={value} value={value}>
                      {hiddenReasonLabels[value]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={pending}
                onClick={() => act("hide")}
              >
                Hide review
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() => act("dismiss")}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ReviewReportQueue({
  slug,
  rows,
  canHide,
}: {
  slug: string;
  rows: readonly ReviewReportRow[];
  canHide: boolean;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="review-reports-heading" className="flex flex-col gap-3">
      <h3 id="review-reports-heading" className="text-lg font-medium text-text">
        Reported reviews
      </h3>
      {canHide ? null : (
        <p className="text-sm text-text-muted">Only the owner can hide a review.</p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <ReviewReportItem
            key={`${row.reviewId}:${row.status}`}
            slug={slug}
            row={row}
            canHide={canHide}
          />
        ))}
      </ul>
    </section>
  );
}
