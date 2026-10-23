"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import {
  EmailChoiceFieldset,
  EmailNoteAndPreview,
  type ImportEmailChoice,
  type ImportEmailHandlers,
} from "./email-decision";
import { FilePicker } from "./file-picker";
import { ImportResultPeople } from "./import-result-people";
import { MigrationJobProgress } from "./job-progress";
import type { ArchivePreview, ArchiveResult, MigrationProgress } from "./types";

export type ImportArchiveStage =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "preview"; readonly preview: ArchivePreview }
  | { readonly kind: "running"; readonly progress: MigrationProgress | null }
  | { readonly kind: "done"; readonly result: ArchiveResult }
  | { readonly kind: "failed"; readonly message: string; readonly canRetry: boolean };

export interface ArchiveConfirmOptions {
  readonly emailChoice: ImportEmailChoice;
  readonly note: string;
}

export interface ImportArchiveCardProps extends ImportEmailHandlers {
  readonly stage: ImportArchiveStage;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly error: string | null;
  readonly formatDate: (iso: string) => string;
  onFile(file: File): void;
  onConfirm(options: ArchiveConfirmOptions): void;
  onRetry(): void;
  onReset(): void;
}

const entityLabels: Readonly<Record<string, string>> = {
  memberships: "Members",
  posts: "Posts",
  comments: "Comments",
  courses: "Courses",
  lessons: "Lessons",
  events: "Events",
  event_rsvps: "RSVPs",
  points_ledger: "Point entries",
  comped_memberships: "Free access",
  subscriptions: "Paid subscriptions",
};

function CountList({ counts }: { counts: Readonly<Record<string, number>> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {Object.entries(entityLabels).map(([key, label]) => (
        <div key={key} className="flex flex-col">
          <dt className="text-text-muted">{label}</dt>
          <dd className="font-semibold text-text">{counts[key] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

function Preview({
  preview,
  formatDate,
  onConfirm,
  onReset,
  ...emailHandlers
}: {
  preview: ArchivePreview;
  formatDate: (iso: string) => string;
  onConfirm(options: ArchiveConfirmOptions): void;
  onReset(): void;
} & ImportEmailHandlers) {
  const [emailChoice, setEmailChoice] = useState<ImportEmailChoice>("later");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        <span className="font-semibold">{preview.communityName}</span>, exported{" "}
        {formatDate(preview.exportedAt)} (format {preview.schemaVersion}).
      </p>
      <CountList counts={preview.counts} />
      <p className="text-sm text-text-muted">
        {preview.people.inviteOnly
          ? `${preview.people.total} people. Each person gets an invitation to join with their own account. Their posts and comments are kept under their name, and nobody is added as a member until they accept.`
          : `${preview.people.total} people: ${preview.people.existing} already have an account here and are linked by email, ${preview.people.new} get a new account without a password.`}{" "}
        {preview.uploads} files.
      </p>
      {preview.warnings.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Before you import</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <EmailChoiceFieldset value={emailChoice} onChange={setEmailChoice} />
      {emailChoice === "never" ? null : (
        <EmailNoteAndPreview note={note} onNoteChange={setNote} {...emailHandlers} />
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className="min-h-11"
          onClick={() => onConfirm({ emailChoice, note: note.trim() })}
        >
          Import everything
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onReset}>
          Choose another file
        </Button>
      </div>
    </div>
  );
}

function Result({ result, onReset }: { result: ArchiveResult; onReset(): void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="success">
        <AlertTitle>Import finished</AlertTitle>
        <AlertDescription>
          <ImportResultPeople result={result} />
          {result.ownerImportedAs === "admin"
            ? " The previous owner is now an admin, and you stay the owner."
            : ""}
        </AlertDescription>
      </Alert>
      <CountList counts={result.imported} />
      {result.subscriptionsToLink > 0 ? (
        <p className="text-sm text-text-muted">
          {result.subscriptionsToLink} paid subscriptions came with the archive. Paying members have
          free access until the date they paid for. Move them under Bring your existing subscribers
          so they subscribe again before then.
        </p>
      ) : null}
      {result.skippedTotal > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Skipped ({result.skippedTotal})</h3>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {result.skipped.slice(0, 20).map((item, index) => (
              <li key={`${item.entity}-${index}`}>
                {item.entity}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Nothing was skipped.</p>
      )}
      <Button type="button" variant="ghost" className="min-h-11 self-start" onClick={onReset}>
        Done
      </Button>
    </div>
  );
}

export function ImportArchiveCard({
  stage,
  available,
  unavailableReason,
  error,
  formatDate,
  onFile,
  onConfirm,
  onRetry,
  onReset,
  onPreviewEmail,
  onSendTestEmail,
}: ImportArchiveCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import archive</CardTitle>
        <CardDescription>
          Restore a Cohory archive into this community. It works on a new, empty community: create
          the community first, then import. You see what will move before anything changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {stage.kind === "idle" ? (
          available ? (
            <FilePicker
              label="Choose archive (.zip)"
              accept=".zip,application/zip"
              onFile={onFile}
            />
          ) : (
            <p className="text-sm text-text-muted">{unavailableReason}</p>
          )
        ) : null}
        {stage.kind === "uploading" ? (
          <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />
            Checking the archive…
          </p>
        ) : null}
        {stage.kind === "preview" ? (
          <Preview
            preview={stage.preview}
            formatDate={formatDate}
            onConfirm={onConfirm}
            {...(onPreviewEmail ? { onPreviewEmail } : {})}
            {...(onSendTestEmail ? { onSendTestEmail } : {})}
            onReset={onReset}
          />
        ) : null}
        {stage.kind === "running" ? (
          <MigrationJobProgress label="Importing…" progress={stage.progress} />
        ) : null}
        {stage.kind === "done" ? <Result result={stage.result} onReset={onReset} /> : null}
        {stage.kind === "failed" ? (
          <div className="flex flex-col gap-3">
            <Alert variant="danger">
              <AlertTitle>The import stopped</AlertTitle>
              <AlertDescription>{stage.message}</AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-3">
              {stage.canRetry ? (
                <Button type="button" variant="secondary" className="min-h-11" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
              <Button type="button" variant="ghost" className="min-h-11" onClick={onReset}>
                Start over
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
