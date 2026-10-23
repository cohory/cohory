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

import { reportContentAction } from "../../lib/moderation/actions";
import { reportReasonLabels, reportReasonOrder } from "../../lib/moderation/labels";
import { RadioCards } from "../manage/radio-cards";

export interface ReportTarget {
  readonly type: "post" | "comment";
  readonly id: string;
}

export function ReportDialog({
  slug,
  target,
  onClose,
}: {
  slug: string;
  target: ReportTarget | null;
  onClose(): void;
}) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noun = target?.type === "comment" ? "comment" : "post";

  function close() {
    setReason("spam");
    setNote("");
    setError(null);
    onClose();
  }

  function submit() {
    if (!target) return;
    startTransition(async () => {
      const result = await reportContentAction({ slug, ...target, reason, note });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Thanks. The moderators will take a look.");
      close();
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open || pending ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this {noun}</DialogTitle>
          <DialogDescription>
            Only the moderators see reports, and they don&apos;t see who sent them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <RadioCards
            legend="What is wrong with it?"
            name="report-reason"
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
