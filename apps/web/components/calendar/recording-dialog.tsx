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
  Input,
} from "@cohory/ui";
import { useState, type FormEvent } from "react";

export function RecordingDialog({
  open,
  onOpenChange,
  initialUrl,
  onSave,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialUrl: string;
  onSave(url: string): Promise<string | null>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const message = await onSave(url.trim());
    setPending(false);
    setError(message);
    if (!message) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Recording link</DialogTitle>
            <DialogDescription>
              Members see a Watch recording button on every date of this event. Leave it empty to
              remove the link.
            </DialogDescription>
          </DialogHeader>
          <Field label="Link" error={error ?? undefined}>
            {(control) => (
              <Input
                {...control}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={url}
                disabled={pending}
                onChange={(event) => setUrl(event.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              Save link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
