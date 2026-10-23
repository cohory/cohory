"use client";

import { useState } from "react";

import { Button } from "../primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../primitives/dialog";

type SeriesScope = "this" | "series";

interface SeriesDeletePreview {
  rsvps: number;
  dates: number;
}

interface SeriesScopeDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onThisOnly(): void;
  onSeries(): void;
  dateLabel: string;
  deletePreview?: SeriesDeletePreview | null;
  pending?: SeriesScope | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function deleteConsequence(preview: SeriesDeletePreview | null | undefined): string {
  if (!preview) return "Every date in the series is removed. This can't be undone.";
  if (preview.dates === 0) return "There are no upcoming dates left. This can't be undone.";
  const dates = plural(preview.dates, "upcoming date", "upcoming dates");
  const removed =
    preview.rsvps === 0
      ? `${dates} will be removed. No one has said they are going yet.`
      : `${plural(preview.rsvps, "RSVP", "RSVPs")} on ${dates} will be removed.`;
  return `${removed} This can't be undone.`;
}

function SeriesScopeDialog({
  open,
  onOpenChange,
  onThisOnly,
  onSeries,
  dateLabel,
  deletePreview,
  pending = null,
}: SeriesScopeDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const busy = pending !== null;

  function changeOpen(next: boolean) {
    if (!next) setConfirming(false);
    onOpenChange(next);
  }

  const keep = (
    <Button type="button" variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
      Keep event
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete the whole series?</DialogTitle>
              <DialogDescription>{deleteConsequence(deletePreview)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {keep}
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                aria-busy={pending === "series" || undefined}
                onClick={onSeries}
              >
                Delete series
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Cancel {dateLabel} or delete the series?</DialogTitle>
              <DialogDescription>
                Canceling keeps the other dates. Members see {dateLabel} as canceled, and you can
                restore it later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {keep}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                aria-busy={pending === "this" || undefined}
                onClick={onThisOnly}
              >
                Cancel this date
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Delete series
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export {
  SeriesScopeDialog,
  type SeriesDeletePreview,
  type SeriesScope,
  type SeriesScopeDialogProps,
};
