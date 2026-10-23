"use client";

import { Button, Field, Input, Textarea, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  addImportedMovesAction,
  addMovesAction,
  remindMovesAction,
} from "../../../../../../lib/payments/move-actions";

function people(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

export function AddMovesForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [lines, setLines] = useState("");
  const [freeUntil, setFreeUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addMovesAction({ slug, lines, freeUntil });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setLines("");
      toast.success(`${people(result.data)} saved to the list.`);
      router.refresh();
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label="Email addresses"
        description="One per line. Add the old renewal date after an address to set it for that person, like ada@example.com 2026-11-18."
        error={error ?? undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            value={lines}
            disabled={pending}
            onChange={(event) => setLines(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Free until"
        description="For lines without a date. Members aren't charged before this day."
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            className="max-w-48"
            value={freeUntil}
            disabled={pending}
            onChange={(event) => setFreeUntil(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" className="min-h-11 self-start" disabled={pending}>
        {pending ? "Saving…" : "Add to the list"}
      </Button>
    </form>
  );
}

export function AddImportedMoves({
  slug,
  jobId,
  count,
  from,
}: {
  slug: string;
  jobId: string;
  count: number;
  from: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-sm text-text">
        {people(count)} who paid on {from} {count === 1 ? "is" : "are"} not on this list yet.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addImportedMovesAction({ slug, jobId });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            toast.success(`${people(result.data)} added to the list.`);
            router.refresh();
          })
        }
      >
        {pending ? "Adding…" : "Add them to the list"}
      </Button>
    </div>
  );
}

export function RemindMoves({ slug }: { slug: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="min-h-11 self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await remindMovesAction({ slug });
            setMessage(
              result.ok
                ? result.data === 0
                  ? "No one to email. Everyone not moved yet got an email in the last week, or their free time ended more than a week ago."
                  : `Email sent to ${people(result.data)}.`
                : result.message,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Sending…" : "Email everyone not moved yet"}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
