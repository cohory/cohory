"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { Switch } from "../primitives/switch";
import { EmailNoteAndPreview, type ImportEmailHandlers } from "./email-decision";
import { FilePicker } from "./file-picker";
import { MigrationJobProgress } from "./job-progress";
import { DownloadRowsToFix } from "./rows-to-fix";
import type { CsvPreview, CsvResult, CsvRowStatus, MigrationProgress } from "./types";

export type MembersCsvStage =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "preview"; readonly preview: CsvPreview }
  | { readonly kind: "running"; readonly progress: MigrationProgress | null }
  | { readonly kind: "done"; readonly result: CsvResult }
  | { readonly kind: "failed"; readonly message: string; readonly canRetry: boolean };

export interface MembersCsvCardProps extends ImportEmailHandlers {
  readonly stage: MembersCsvStage;
  readonly error: string | null;
  onFile(file: File): void;
  onConfirm(options: MembersCsvConfirmOptions): void;
  onRetry(): void;
  onReset(): void;
}

export interface MembersCsvConfirmOptions {
  readonly mode: "invite" | "add";
  readonly notify: boolean;
  readonly resend: boolean;
  readonly note: string;
}

const statusLabels: Record<CsvRowStatus, string> = {
  ready: "Ready",
  new_account: "New",
  existing_account: "Has an account",
  already_member: "Already a member",
  invited: "Invited",
  left_out: "Left out",
  error: "Fix this row",
};

const statusVariants = {
  ready: "accent",
  new_account: "accent",
  existing_account: "neutral",
  already_member: "neutral",
  invited: "neutral",
  left_out: "neutral",
  error: "warning",
} as const;

const previewRowLimit = 100;

function Preview({
  preview,
  onConfirm,
  onReset,
  ...emailHandlers
}: {
  preview: CsvPreview;
  onConfirm(options: MembersCsvConfirmOptions): void;
  onReset(): void;
} & ImportEmailHandlers) {
  const [mode, setMode] = useState<"invite" | "add">("invite");
  const [notify, setNotify] = useState(true);
  const [resend, setResend] = useState(false);
  const [onlyToFix, setOnlyToFix] = useState(false);
  const [note, setNote] = useState("");
  const includeInvited = mode === "invite" && resend;
  const count = preview.ready + (includeInvited ? preview.invited : 0);
  const overLimit =
    mode === "add" &&
    preview.memberLimit !== null &&
    preview.activeMembers + count > preview.memberLimit;
  const toFix = preview.rows.filter((row) => row.status === "error");
  const shown = onlyToFix ? toFix : preview.rows;
  const rows = shown.slice(0, previewRowLimit);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        {preview.ready} ready, {preview.alreadyMembers} already members
        {preview.invited > 0 ? `, ${preview.invited} already invited` : ""}
        {preview.leftOut > 0 ? `, ${preview.leftOut} left out` : ""}, {preview.errors} with errors.
        Rows with errors are skipped.
      </p>
      {preview.notes.map((note) => (
        <p key={note} className="text-sm text-text-muted">
          {note}
        </p>
      ))}
      {toFix.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-3 text-sm text-text">
            <Switch
              checked={onlyToFix}
              onCheckedChange={setOnlyToFix}
              aria-label="Only rows to fix"
            />
            Only rows to fix
          </label>
          <DownloadRowsToFix
            rows={toFix.map((row) => ({
              location: `Row ${row.line}`,
              reason: row.message ?? "",
              ...(row.values ? { values: row.values } : {}),
            }))}
          />
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Rows in the file</caption>
          <thead className="bg-surface text-text-muted">
            <tr>
              <th scope="col" className="p-2 font-medium">
                Row
              </th>
              <th scope="col" className="p-2 font-medium">
                Email
              </th>
              <th scope="col" className="hidden p-2 font-medium sm:table-cell">
                Role
              </th>
              <th scope="col" className="p-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.line}>
                <td className="p-2 text-text-muted">{row.line}</td>
                <td className="max-w-48 truncate p-2 text-text sm:max-w-none">
                  {row.email}
                  {row.message ? (
                    <span className="block text-xs text-text-muted">{row.message}</span>
                  ) : null}
                </td>
                <td className="hidden p-2 text-text-muted sm:table-cell">{row.role ?? ""}</td>
                <td className="p-2">
                  <Badge variant={statusVariants[row.status]}>{statusLabels[row.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > previewRowLimit ? (
        <p className="text-sm text-text-muted">
          Showing the first {previewRowLimit} of {shown.length} rows.
        </p>
      ) : null}
      {preview.invited > 0 && mode === "invite" ? (
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <Switch
            checked={resend}
            onCheckedChange={setResend}
            aria-label="Send again to people already invited"
          />
          Send again to {preview.invited} {preview.invited === 1 ? "person" : "people"} already
          invited
        </label>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-text">How should people join?</legend>
        <label className="flex min-h-11 items-start gap-3 text-sm text-text">
          <input
            type="radio"
            name="csv-mode"
            className="mt-1 size-4 accent-accent"
            checked={mode === "invite"}
            onChange={() => setMode("invite")}
          />
          <span>
            Send invitations
            <span className="block text-text-muted">
              Each person gets an email with a link that works once and expires in 30 days.
            </span>
          </span>
        </label>
        {preview.addAllowed ? (
          <label className="flex min-h-11 items-start gap-3 text-sm text-text">
            <input
              type="radio"
              name="csv-mode"
              className="mt-1 size-4 accent-accent"
              checked={mode === "add"}
              onChange={() => setMode("add")}
            />
            <span>
              Add them now
              <span className="block text-text-muted">
                Memberships start right away with the role from the file. People with an account
                whose email is not confirmed get an invitation instead. For self hosted communities.
              </span>
            </span>
          </label>
        ) : null}
      </fieldset>
      {mode === "add" ? (
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <Switch checked={notify} onCheckedChange={setNotify} aria-label="Email each person" />
          Email each person that they were added
        </label>
      ) : null}
      {mode === "invite" || notify ? (
        <EmailNoteAndPreview note={note} onNoteChange={setNote} {...emailHandlers} />
      ) : null}
      {overLimit ? (
        <Alert variant="warning">
          <AlertDescription>
            This would go over the limit of {preview.memberLimit} members. Remove rows or send
            invitations instead.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className="min-h-11"
          disabled={count === 0 || overLimit}
          onClick={() =>
            onConfirm({
              mode,
              notify: mode === "add" ? notify : true,
              resend: includeInvited,
              note: note.trim(),
            })
          }
        >
          {mode === "invite"
            ? `Send ${count} ${count === 1 ? "invitation" : "invitations"}`
            : `Add ${count} ${count === 1 ? "member" : "members"}`}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onReset}>
          Choose another file
        </Button>
      </div>
    </div>
  );
}

function csvSummary(result: CsvResult): string {
  const notSent = result.notSent ?? 0;
  const done =
    result.mode === "invite"
      ? `${result.invited} ${result.invited === 1 ? "invitation" : "invitations"} sent.`
      : `${result.added} ${result.added === 1 ? "member" : "members"} added, ${result.emailsSent} ${result.emailsSent === 1 ? "email" : "emails"} sent.`;
  return [
    done,
    notSent > 0 ? `${notSent} not sent because the address opted out or could not be reached.` : "",
    result.skipped > 0 ? `${result.skipped} rows skipped.` : "",
    result.limitReached ? "The member limit was reached." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function CsvDone({ result, onReset }: { result: CsvResult; onReset(): void }) {
  const skippedRows = result.skippedRows ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="success">
        <AlertTitle>{result.mode === "invite" ? "Invitations sent" : "Members added"}</AlertTitle>
        <AlertDescription>{csvSummary(result)}</AlertDescription>
      </Alert>
      {skippedRows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Rows skipped ({skippedRows.length})</h3>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {skippedRows.slice(0, 50).map((row) => (
              <li key={row.line}>
                Row {row.line}: {row.reason}
              </li>
            ))}
          </ul>
          <DownloadRowsToFix
            rows={skippedRows.map((row) => ({ location: `Row ${row.line}`, reason: row.reason }))}
          />
        </div>
      ) : null}
      <Button type="button" variant="ghost" className="min-h-11 self-start" onClick={onReset}>
        Done
      </Button>
    </div>
  );
}

export function MembersCsvCard({
  stage,
  error,
  onFile,
  onConfirm,
  onRetry,
  onReset,
  onPreviewEmail,
  onSendTestEmail,
}: MembersCsvCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import members from a spreadsheet</CardTitle>
        <CardDescription>
          Upload a CSV file with an email column, and name and role columns if you have them. Roles
          can be member, moderator, or admin. Up to 5000 rows. Nothing happens until you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {stage.kind === "idle" ? (
          <FilePicker label="Choose CSV file" accept=".csv,text/csv" onFile={onFile} />
        ) : null}
        {stage.kind === "uploading" ? (
          <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />
            Checking the file…
          </p>
        ) : null}
        {stage.kind === "preview" ? (
          <Preview
            preview={stage.preview}
            onConfirm={onConfirm}
            {...(onPreviewEmail ? { onPreviewEmail } : {})}
            {...(onSendTestEmail ? { onSendTestEmail } : {})}
            onReset={onReset}
          />
        ) : null}
        {stage.kind === "running" ? (
          <MigrationJobProgress label="Importing members…" progress={stage.progress} />
        ) : null}
        {stage.kind === "done" ? <CsvDone result={stage.result} onReset={onReset} /> : null}
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
