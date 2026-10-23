"use client";

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MigrationJobBadge,
} from "@cohory/ui";
import { Download } from "lucide-react";
import { useState } from "react";

import type { ImportHistoryItem } from "../../lib/migration/jobs";

export interface ImportHistoryProps {
  readonly items: readonly ImportHistoryItem[];
  readonly formatDate: (iso: string) => string;
  onSendEmails?(jobId: string): Promise<void>;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

function SendEmailsButton({
  item,
  onSendEmails,
}: {
  item: ImportHistoryItem;
  onSendEmails(jobId: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 self-start"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          onSendEmails(item.id)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : "Something went wrong."),
            )
            .finally(() => setBusy(false));
        }}
      >
        Send the emails
      </Button>
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ImportHistory({ items, formatDate, onSendEmails }: ImportHistoryProps) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import history</CardTitle>
        <CardDescription>
          Every import that ran here, with what moved, what was skipped, and who was emailed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <MigrationJobBadge status={item.status} />
                  <span className="font-medium text-text">{item.source}</span>
                  <span className="text-text-muted">{formatDate(item.at)}</span>
                </div>
                <p className="text-text-muted">
                  {item.errorMessage ??
                    [
                      item.counts ?? "Nothing moved",
                      plural(item.skipped, "row skipped", "rows skipped"),
                      item.emailsWaiting
                        ? "Emails not sent yet"
                        : plural(item.emailsSent, "email sent", "emails sent"),
                    ].join(". ")}
                </p>
                {item.emailsWaiting && onSendEmails ? (
                  <SendEmailsButton item={item} onSendEmails={onSendEmails} />
                ) : null}
              </div>
              <a
                href={item.reportHref}
                download
                aria-label={`Download report of the ${item.source} import, ${formatDate(item.at)}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
                Download report
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
