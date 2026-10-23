"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
  toast,
} from "@cohory/ui";
import type { ReportReason } from "@cohory/db/schema";
import { useState, useTransition } from "react";

import { reportReasonLabels, reportReasonOrder } from "../../lib/moderation/labels";
import { reportReviewAction } from "../../lib/reviews/actions";
import { RadioCards } from "../manage/radio-cards";

export function ReviewReportDialog({
  slug,
  reviewId,
  onClose,
}: {
  slug: string;
  reviewId: string | null;
  onClose(): void;
}) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setReason("spam");
    setNote("");
    setError(null);
    onClose();
  }

  function submit() {
    if (!reviewId) return;
    startTransition(async () => {
      const result = await reportReviewAction({ slug, reviewId, reason, note });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Thanks. The moderators will take a look.");
      close();
    });
  }

  return (
    <Dialog
      open={reviewId !== null}
      onOpenChange={(open) => (open || pending ? undefined : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this review</DialogTitle>
          <DialogDescription>
            Only the moderators see reports, and they don&apos;t see who sent them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <RadioCards
            legend="What is wrong with it?"
            name="review-report-reason"
            value={reason}
            columns={2}
            options={reportReasonOrder.map((value) => ({
              value,
              label: reportReasonLabels[value],
            }))}
            onChange={setReason}
          />
          <Field label="Anything the moderators should know? (optional)">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
