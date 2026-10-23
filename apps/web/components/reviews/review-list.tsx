"use client";

import { Button, cn, toast } from "@cohory/ui";
import { useState, useTransition } from "react";

import { loadReviewsAction } from "../../lib/reviews/actions";
import type { ReviewPageRows, ReviewRow } from "../../lib/reviews/views";
import { ReviewItem } from "./review-item";
import { ReviewReportDialog } from "./review-report-dialog";

export function ReviewList({
  slug,
  initial,
  ratings,
  canReply,
  canReport,
}: {
  slug: string;
  initial: ReviewPageRows;
  ratings: readonly { rating: number; count: number }[];
  canReply: boolean;
  canReport: boolean;
}) {
  const [filter, setFilter] = useState<number | null>(null);
  const [rows, setRows] = useState<readonly ReviewRow[]>(initial.rows);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [reporting, setReporting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = ratings.reduce((sum, row) => sum + row.count, 0);

  function load(rating: number | null, cursor: string | null) {
    startTransition(async () => {
      const result = await loadReviewsAction({ slug, rating, cursor });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setFilter(rating);
      setRows((current) =>
        cursor === null ? result.data.rows : [...current, ...result.data.rows],
      );
      setNextCursor(result.data.nextCursor);
    });
  }

  if (total === 0) {
    return null;
  }

  const chip =
    "inline-flex min-h-11 items-center rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Filter reviews by stars" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filter === null}
          disabled={pending}
          onClick={() => load(null, null)}
          className={cn(
            chip,
            filter === null
              ? "border-accent bg-accent-muted text-text"
              : "border-border text-text-muted",
          )}
        >
          All ({total})
        </button>
        {ratings.map(({ rating, count }) => (
          <button
            key={rating}
            type="button"
            aria-pressed={filter === rating}
            disabled={pending || count === 0}
            onClick={() => load(rating, null)}
            className={cn(
              chip,
              filter === rating
                ? "border-accent bg-accent-muted text-text"
                : "border-border text-text-muted",
              count === 0 ? "opacity-60" : null,
            )}
          >
            {rating === 1 ? "1 star" : `${rating} stars`} ({count})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No reviews with this rating.</p>
      ) : (
        <ul aria-label="Reviews" className="flex flex-col gap-4">
          {rows.map((row) => (
            <ReviewItem
              key={row.id}
              slug={slug}
              row={row}
              canReply={canReply}
              canReport={canReport && !row.own}
              onReport={() => setReporting(row.id)}
            />
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Button
          variant="secondary"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={() => load(filter, nextCursor)}
        >
          Show more reviews
        </Button>
      ) : null}
      <ReviewReportDialog slug={slug} reviewId={reporting} onClose={() => setReporting(null)} />
    </div>
  );
}
