"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cohory/ui";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { JoinRequestForm, type JoinQuestionView } from "./join-request-form";

export function JoinRequestDialog({
  slug,
  name,
  questions,
  triggerLabel = "Request to join",
  openFromLink = true,
}: {
  slug: string;
  name: string;
  questions: readonly JoinQuestionView[];
  triggerLabel?: string;
  openFromLink?: boolean;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(openFromLink && searchParams.get("join") === "request");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" className="min-h-11 w-full md:w-auto" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request to join {name}</DialogTitle>
          <DialogDescription>
            The community team reviews new members. You&apos;ll get in as soon as they approve.
          </DialogDescription>
        </DialogHeader>
        <JoinRequestForm slug={slug} questions={questions} submitLabel="Send request" />
      </DialogContent>
    </Dialog>
  );
}
