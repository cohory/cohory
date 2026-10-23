"use client";

import { Download, Loader2Icon, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "../primitives/alert";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { formatBytes, MigrationJobBadge, MigrationJobProgress } from "./job-progress";
import type { ExportJobItem } from "./types";

export interface ExportArchiveCardProps {
  readonly jobs: readonly ExportJobItem[];
  readonly starting: boolean;
  readonly error: string | null;
  readonly formatDate: (iso: string) => string;
  readonly deletingId?: string | null;
  onStart(): void;
  onDelete?(id: string): void;
}

export function ExportArchiveCard({
  jobs,
  starting,
  error,
  formatDate,
  deletingId = null,
  onStart,
  onDelete,
}: ExportArchiveCardProps) {
  const active = jobs.find((job) => job.status === "queued" || job.status === "running");
  const latest = jobs[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Export archive</CardTitle>
        <CardDescription>
          One zip file with your members, posts, comments, courses, events, points, and files. Use
          it as a backup or to move to another Cohory server. It has spreadsheets you can open
          anywhere. Passwords and payment history stay here. Each export is deleted after 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {active ? (
          <MigrationJobProgress label="Preparing your archive…" progress={active.progress} />
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={starting || active !== undefined}
            onClick={onStart}
          >
            {starting ? <Loader2Icon aria-hidden="true" className="size-4 animate-spin" /> : null}
            {active ? "Export running" : "Start export"}
          </Button>
          {latest?.downloadHref ? (
            <Button asChild variant="secondary" className="min-h-11">
              <a href={latest.downloadHref} download>
                <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
                Download latest archive
              </a>
            </Button>
          ) : null}
        </div>
        {jobs.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">Export history</h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <MigrationJobBadge status={job.status} />
                    <span className="text-text">{formatDate(job.createdAt)}</span>
                    {job.fileBytes !== null ? (
                      <span className="text-text-muted">{formatBytes(job.fileBytes)}</span>
                    ) : null}
                    {job.contents ? <span className="text-text-muted">{job.contents}</span> : null}
                    {job.deletedAt ? (
                      <span className="text-text-muted">Deleted {formatDate(job.deletedAt)}</span>
                    ) : job.expiresAt ? (
                      <span className="text-text-muted">
                        Kept until {formatDate(job.expiresAt)}
                      </span>
                    ) : null}
                    {job.errorMessage ? (
                      <span className="text-text-muted">{job.errorMessage}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {job.downloadHref ? (
                      <a
                        href={job.downloadHref}
                        download
                        className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Download
                      </a>
                    ) : null}
                    {onDelete && job.downloadHref ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11"
                        disabled={deletingId === job.id}
                        aria-label={`Delete the export of ${formatDate(job.createdAt)}`}
                        onClick={() => onDelete(job.id)}
                      >
                        <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.5} />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
