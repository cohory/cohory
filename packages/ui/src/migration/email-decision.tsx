"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "../primitives/alert";
import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Textarea } from "../primitives/textarea";

export type ImportEmailChoice = "now" | "later" | "never";

export interface ImportEmailPreview {
  readonly subject: string;
  readonly text: string;
}

export interface ImportEmailHandlers {
  onPreviewEmail?(note: string): Promise<ImportEmailPreview>;
  onSendTestEmail?(note: string): Promise<void>;
}

export const importNoteMaxLength = 500;

const choices: readonly {
  readonly value: ImportEmailChoice;
  readonly label: string;
  readonly help: string;
}[] = [
  {
    value: "now",
    label: "Email everyone now",
    help: "When the import finishes, each person gets a link to get in.",
  },
  {
    value: "later",
    label: "I will send emails later",
    help: "Nothing goes out yet. Send the emails from Import history when you are ready.",
  },
  {
    value: "never",
    label: "Do not email",
    help: "Nobody gets an email from this import. You can still email one person from People.",
  },
];

export function EmailChoiceFieldset({
  value,
  onChange,
}: {
  value: ImportEmailChoice;
  onChange(choice: ImportEmailChoice): void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text">Email these people?</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="flex min-h-11 items-start gap-3 text-sm text-text">
          <input
            type="radio"
            name={name}
            className="mt-1 size-4 accent-accent"
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>
            {choice.label}
            <span className="block text-text-muted">{choice.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "sent" }
  | { readonly kind: "error"; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

export function EmailNoteAndPreview({
  note,
  onNoteChange,
  onPreviewEmail,
  onSendTestEmail,
}: {
  note: string;
  onNoteChange(note: string): void;
} & ImportEmailHandlers) {
  const [preview, setPreview] = useState<ImportEmailPreview | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "busy";

  async function run(work: () => Promise<void>) {
    setStatus({ kind: "busy" });
    try {
      await work();
    } catch (error: unknown) {
      setStatus({ kind: "error", message: messageOf(error) });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Note from you (optional)"
        description="Added to every email as plain text. Links are left out."
      >
        {(control) => (
          <Textarea
            {...control}
            value={note}
            maxLength={importNoteMaxLength}
            onChange={(event) => {
              onNoteChange(event.currentTarget.value);
              setPreview(null);
            }}
          />
        )}
      </Field>
      {onPreviewEmail || onSendTestEmail ? (
        <div className="flex flex-wrap gap-3">
          {onPreviewEmail ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setPreview(await onPreviewEmail(note));
                  setStatus({ kind: "idle" });
                })
              }
            >
              Preview email
            </Button>
          ) : null}
          {onSendTestEmail ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await onSendTestEmail(note);
                  setStatus({ kind: "sent" });
                })
              }
            >
              Send me a test
            </Button>
          ) : null}
        </div>
      ) : null}
      <p role="status" className="text-sm text-text-muted">
        {busy ? (
          <span className="flex items-center gap-2">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />
            Working on it
          </span>
        ) : status.kind === "sent" ? (
          "Test sent to your email address."
        ) : null}
      </p>
      {status.kind === "error" ? (
        <Alert variant="danger">
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      ) : null}
      {preview ? (
        <section
          aria-label="Email preview"
          className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
        >
          <p className="font-semibold text-text">{preview.subject}</p>
          <p className="whitespace-pre-wrap break-words text-text-muted">{preview.text}</p>
        </section>
      ) : null}
    </div>
  );
}
