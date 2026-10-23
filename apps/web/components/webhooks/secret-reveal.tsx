"use client";

import { Alert, AlertDescription, Button } from "@cohory/ui";

import { CopyButton } from "../manage/copy-button";

export function SecretReveal({ secret, onDone }: { secret: string; onDone(): void }) {
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>
          Copy this signing secret now and store it with your receiver. You won&apos;t see it again.
        </span>
        <code
          data-testid="webhook-secret"
          className="rounded-sm bg-surface-raised px-2 py-1 font-mono text-xs break-all text-text"
        >
          {secret}
        </code>
        <span className="flex flex-wrap gap-2">
          <CopyButton value={secret} label="Copy secret" copiedMessage="Secret copied." />
          <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>
            I saved it
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
