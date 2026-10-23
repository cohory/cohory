"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cohory/ui";

import { CopyButton } from "../manage/copy-button";

export interface RevealedToken {
  readonly token: string;
  readonly slug: string;
  readonly title?: string;
}

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

const codeClass =
  "block rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs break-all text-text";

export function TokenReveal({
  revealed,
  onDone,
}: {
  revealed: RevealedToken | null;
  onDone(): void;
}) {
  const base = origin();
  return (
    <Dialog
      open={revealed !== null}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{revealed?.title ?? "Copy your token now"}</DialogTitle>
          <DialogDescription>
            This is the only time we show it. Store it somewhere safe, like a password manager or
            your tool&apos;s secret settings. Anyone with it can act within its permissions.
          </DialogDescription>
        </DialogHeader>
        {revealed ? (
          <div className="flex flex-col gap-4">
            <code data-testid="new-token" className={`${codeClass} text-sm`}>
              {revealed.token}
            </code>
            <CopyButton value={revealed.token} label="Copy token" copiedMessage="Token copied." />
            <section aria-labelledby="token-howto" className="flex flex-col gap-2 text-sm">
              <h3 id="token-howto" className="font-medium text-text">
                How to use it
              </h3>
              <p className="text-text-muted">
                Send it in the Authorization header. Keep the token in an environment variable, not
                in the command itself:
              </p>
              <code className={codeClass}>
                {`curl -H "Authorization: Bearer $COHORY_TOKEN" ${base}/api/v1/communities/${revealed.slug}`}
              </code>
              <p className="text-text-muted">
                For an AI assistant that supports MCP, use the server address below and the token as
                a Bearer token.
              </p>
              <code className={codeClass}>{`${base}/mcp`}</code>
            </section>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onDone} className="min-h-11">
            I stored it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
