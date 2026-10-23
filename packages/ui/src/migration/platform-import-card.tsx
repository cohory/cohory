"use client";

import { ExternalLink, Loader2Icon, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import {
  EmailChoiceFieldset,
  EmailNoteAndPreview,
  type ImportEmailChoice,
  type ImportEmailHandlers,
} from "./email-decision";
import { ImportResultPeople } from "./import-result-people";
import { MigrationJobProgress } from "./job-progress";
import { AuthorChoices, ImportMapping } from "./platform-import-mapping";
import { DownloadRowsToFix } from "./rows-to-fix";
import type {
  ArchiveResult,
  MigrationProgress,
  PlatformImportPreview,
  PlatformSourceOption,
} from "./types";

export type PlatformImportStage =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "preview"; readonly preview: PlatformImportPreview }
  | { readonly kind: "running"; readonly progress: MigrationProgress | null }
  | { readonly kind: "done"; readonly result: ArchiveResult }
  | { readonly kind: "failed"; readonly message: string; readonly canRetry: boolean };

export interface PlatformImportCardProps extends ImportEmailHandlers {
  readonly sources: readonly PlatformSourceOption[];
  readonly selected: PlatformSourceOption["id"];
  readonly stage: PlatformImportStage;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly error: string | null;
  readonly maxFiles: number;
  onSelect(source: PlatformSourceOption["id"]): void;
  onFiles(files: File[]): void;
  onConfirm(options: PlatformConfirmOptions): void;
  onSwitchSource?(source: PlatformSourceOption["id"]): void;
  onRetry(): void;
  onReset(): void;
}

export interface PlatformConfirmOptions {
  readonly emailChoice: ImportEmailChoice;
  readonly note: string;
  readonly authors: Readonly<Record<string, string>>;
}

const dateOrderNotes = {
  dmy: "Dates such as 03/04/2025 were read day first, as 3 April 2025.",
  mdy: "Dates such as 03/04/2025 were read month first, as 4 March 2025.",
} as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function PeopleSummary({ preview }: { preview: PlatformImportPreview }) {
  const members = preview.counts["memberships"] ?? 0;
  const former = preview.formerMemberAuthors + preview.ambiguousAuthors.length;
  const fresh = preview.people.new - preview.people.keptApart;
  return (
    <div className="flex flex-col gap-1 text-sm text-text-muted">
      <p className="text-text">
        {plural(members, "member", "members")}
        {former > 0 ? `, ${plural(former, "author", "authors")} kept as former member` : ""}.
      </p>
      <p>
        {preview.people.inviteOnly
          ? "Each person gets an invitation to join with their own account. Their posts and comments are kept under their name, and nobody is added as a member until they accept."
          : `${
              preview.people.existing > 0
                ? `${preview.people.existing} already have an account here and are linked by email. `
                : ""
            }${
              preview.people.keptApart > 0
                ? `${preview.people.keptApart} already use Cohory and get an invitation to claim their history. `
                : ""
            }${fresh} get a new account without a password.`}
      </p>
    </div>
  );
}

const countLabels: Readonly<Record<string, string>> = {
  memberships: "Members",
  categories: "Categories",
  posts: "Posts",
  comments: "Comments",
};

function Counts({ counts }: { counts: Readonly<Record<string, number>> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      {Object.entries(countLabels).map(([key, label]) => (
        <div key={key} className="flex flex-col">
          <dt className="text-text-muted">{label}</dt>
          <dd className="font-semibold text-text">{counts[key] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

function LimitsLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      What moves from {name}
      <ExternalLink aria-hidden="true" className="size-4" strokeWidth={1.5} />
    </a>
  );
}

function SourcePicker({
  sources,
  selected,
  onSelect,
}: {
  sources: readonly PlatformSourceOption[];
  selected: PlatformSourceOption["id"];
  onSelect(source: PlatformSourceOption["id"]): void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text">Where is your community now?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <label
            key={source.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm text-text has-[:checked]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name={name}
              className="size-4 accent-accent"
              checked={selected === source.id}
              onChange={() => onSelect(source.id)}
            />
            <span className="font-medium">{source.name}</span>
            <span className="ml-auto text-xs text-text-muted">Importer {source.version}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FilesPicker({
  source,
  maxFiles,
  onFiles,
}: {
  source: PlatformSourceOption;
  maxFiles: number;
  onFiles(files: File[]): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const label = `Choose ${source.name} files`;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2 text-sm">
        {source.files.map((file) => (
          <li key={file.label}>
            <span className="font-medium text-text">{file.label}.</span>{" "}
            <span className="text-text-muted">{file.description}</span>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={source.accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []).slice(0, maxFiles);
          if (files.length > 0) onFiles(files);
          event.currentTarget.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 self-start"
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" className="size-4" strokeWidth={1.5} />
        {label}
      </Button>
      <p className="text-xs text-text-muted">
        Up to {maxFiles} CSV or JSON files, 25 MB together. Files are read as data and never run.
      </p>
    </div>
  );
}

function Preview({
  preview,
  onConfirm,
  onSwitchSource,
  onReset,
  ...emailHandlers
}: {
  preview: PlatformImportPreview;
  onConfirm(options: PlatformConfirmOptions): void;
  onSwitchSource?(source: PlatformSourceOption["id"]): void;
  onReset(): void;
} & ImportEmailHandlers) {
  const [emailChoice, setEmailChoice] = useState<ImportEmailChoice>("later");
  const [note, setNote] = useState("");
  const [authors, setAuthors] = useState<Readonly<Record<string, string>>>({});
  const unrecognized = preview.files.filter((file) => !file.recognized).length;
  const mostlyUnrecognized = unrecognized * 2 > preview.files.length;
  const blocked = preview.overMemberLimit || mostlyUnrecognized;
  const suggested = preview.suggestedSource;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text">Files</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {preview.files.map((file) => (
            <li key={file.name} className="flex flex-wrap items-center gap-2">
              <span className="break-all text-text">{file.name}</span>
              <Badge variant={file.recognized ? "success" : "warning"}>{file.label}</Badge>
              {file.recognized ? <span className="text-text-muted">{file.rows} rows</span> : null}
            </li>
          ))}
        </ul>
      </div>
      {suggested ? (
        <Alert variant="warning">
          <AlertTitle>These files look like a {suggested.name} export</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {mostlyUnrecognized
              ? `Most files are not ${preview.sourceName} files, so importing is off.`
              : `Some files are not ${preview.sourceName} files.`}
            {onSwitchSource ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => onSwitchSource(suggested.id)}
              >
                Use {suggested.name} instead
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <Counts counts={preview.counts} />
      <PeopleSummary preview={preview} />
      {preview.dateOrder ? (
        <p className="text-sm text-text-muted">{dateOrderNotes[preview.dateOrder]}</p>
      ) : null}
      <ImportMapping mapping={preview.mapping} />
      <AuthorChoices
        authors={preview.ambiguousAuthors}
        choices={authors}
        onChoose={(placeholderId, memberId) =>
          setAuthors((current) =>
            Object.fromEntries([
              ...Object.entries(current).filter(([key]) => key !== placeholderId),
              ...(memberId ? [[placeholderId, memberId]] : []),
            ]),
          )
        }
      />
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
      {preview.unknownColumns.length > 0 ? (
        <p className="text-sm text-text-muted">
          Columns left out:{" "}
          {preview.unknownColumns
            .map((entry) => `${entry.columns.join(", ")} (${entry.file})`)
            .join("; ")}
          .
        </p>
      ) : null}
      {preview.skippedTotal > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">
            Rows left out ({preview.skippedTotal})
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {preview.skipped.slice(0, 20).map((row, index) => (
              <li key={`${row.file}-${row.row}-${index}`}>
                {row.file}, {row.row}: {row.reason}
              </li>
            ))}
          </ul>
          <DownloadRowsToFix
            rows={preview.skipped.map((row) => ({
              location: `${row.file}, ${row.row}`,
              reason: row.reason,
              ...(row.values ? { values: row.values } : {}),
            }))}
          />
        </div>
      ) : null}
      <LimitsLink href={preview.limitsHref} name={preview.sourceName} />
      <EmailChoiceFieldset value={emailChoice} onChange={setEmailChoice} />
      {emailChoice === "never" ? null : (
        <EmailNoteAndPreview note={note} onNoteChange={setNote} {...emailHandlers} />
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className="min-h-11"
          disabled={blocked}
          onClick={() => onConfirm({ emailChoice, note: note.trim(), authors })}
        >
          Import from {preview.sourceName}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onReset}>
          Choose other files
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
        </AlertDescription>
      </Alert>
      <Counts counts={result.imported} />
      {result.skippedTotal > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Skipped ({result.skippedTotal})</h3>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {result.skipped.slice(0, 20).map((item, index) => (
              <li key={`${item.entity}-${index}`}>
                {item.entity}
                {item.sourceId ? `, ${item.sourceId}` : ""}: {item.reason}
              </li>
            ))}
          </ul>
          <DownloadRowsToFix
            rows={result.skipped.map((item) => ({
              location: item.sourceId ? `${item.entity}, ${item.sourceId}` : item.entity,
              reason: item.reason,
              ...(item.values ? { values: item.values } : {}),
            }))}
          />
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

export function PlatformImportCard({
  sources,
  selected,
  stage,
  available,
  unavailableReason,
  error,
  maxFiles,
  onSelect,
  onFiles,
  onConfirm,
  onSwitchSource,
  onRetry,
  onReset,
  onPreviewEmail,
  onSendTestEmail,
}: PlatformImportCardProps) {
  const source = sources.find((entry) => entry.id === selected) ?? sources[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import from another platform</CardTitle>
        <CardDescription>
          Bring members, categories, posts, and comments from Skool or Circle into this community.
          Each importer is best effort: payments, likes, messages, and media stay behind. It works
          on a new, empty community, and you see what will move before anything changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {stage.kind === "idle" && source ? (
          available ? (
            <>
              <SourcePicker sources={sources} selected={source.id} onSelect={onSelect} />
              <FilesPicker source={source} maxFiles={maxFiles} onFiles={onFiles} />
              <LimitsLink href={source.limitsHref} name={source.name} />
            </>
          ) : (
            <p className="text-sm text-text-muted">{unavailableReason}</p>
          )
        ) : null}
        {stage.kind === "uploading" ? (
          <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />
            Reading the files…
          </p>
        ) : null}
        {stage.kind === "preview" ? (
          <Preview
            preview={stage.preview}
            onConfirm={onConfirm}
            {...(onSwitchSource ? { onSwitchSource } : {})}
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
