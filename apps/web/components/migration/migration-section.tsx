"use client";

import {
  ExistingSubscribersCard,
  ExportArchiveCard,
  ImportArchiveCard,
  MembersCsvCard,
  type ImportArchiveStage,
  type MembersCsvStage,
} from "@cohory/ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

import {
  archiveStage,
  csvStage,
  exportItems,
  importedReason,
  importHistory,
  isActive,
  migrationJobJsonSchema,
  migrationJobListSchema,
  uploadSizeError,
  type MigrationJobJson,
} from "../../lib/migration/jobs";
import { importEmailHandlers, sendImportEmails } from "../../lib/migration/import-emails";
import { isPlatformJob } from "../../lib/migration/platform";
import { ImportHistory } from "./import-history";
import { useRefreshAfterSuccess } from "./use-refresh-after-success";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });
const pollMs = 2000;

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDate(iso: string): string {
  return `${dateFormat.format(new Date(iso))} UTC`;
}

export interface MigrationSectionProps {
  readonly slug: string;
  readonly initialJobs: readonly MigrationJobJson[];
  readonly importAvailable: boolean;
  readonly importUnavailableReason: string | null;
  readonly platformImport?: ReactNode;
  readonly subscribers: {
    readonly href: string;
    readonly connected: boolean;
    readonly linking: boolean;
  } | null;
  readonly limits: { readonly archiveBytes: number; readonly csvBytes: number };
}

function pickOpen(jobs: readonly MigrationJobJson[], kind: MigrationJobJson["kind"]) {
  return (
    jobs.find((job) => job.kind === kind && job.status !== "succeeded" && !isPlatformJob(job))
      ?.id ?? null
  );
}

export function MigrationSection({
  slug,
  initialJobs,
  importAvailable,
  importUnavailableReason,
  platformImport,
  subscribers,
  limits,
}: MigrationSectionProps) {
  const base = `/api/v1/communities/${encodeURIComponent(slug)}/manage/migration`;
  const [jobs, setJobs] = useState<readonly MigrationJobJson[]>(initialJobs);
  const [importJobId, setImportJobId] = useState<string | null>(() =>
    pickOpen(initialJobs, "import"),
  );
  const [csvJobId, setCsvJobId] = useState<string | null>(() =>
    pickOpen(initialJobs, "members_csv"),
  );
  const [uploading, setUploading] = useState<"import" | "csv" | null>(null);
  const [starting, setStarting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    export: string | null;
    import: string | null;
    csv: string | null;
  }>({
    export: null,
    import: null,
    csv: null,
  });

  useRefreshAfterSuccess(slug, jobs);

  const merge = useCallback((job: MigrationJobJson) => {
    setJobs((current) => [job, ...current.filter((existing) => existing.id !== job.id)]);
  }, []);

  const request = useCallback(
    async (path: string, init: RequestInit = {}): Promise<unknown> => {
      const response = await fetch(`${base}${path}`, { credentials: "same-origin", ...init });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = errorSchema.safeParse(json);
        throw new Error(
          parsed.success ? parsed.data.error.message : "Something went wrong. Try again.",
        );
      }
      return json;
    },
    [base],
  );

  const refresh = useCallback(async () => {
    const parsed = migrationJobListSchema.safeParse(await request("/jobs"));
    if (parsed.success) setJobs(parsed.data.data);
  }, [request]);

  const polling = jobs.some(isActive);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const run = useCallback(
    async (card: "export" | "import" | "csv", work: () => Promise<unknown>) => {
      setErrors((current) => ({ ...current, [card]: null }));
      try {
        const job = migrationJobJsonSchema.parse(await work());
        merge(job);
        return job;
      } catch (error: unknown) {
        setErrors((current) => ({
          ...current,
          [card]: error instanceof Error ? error.message : "Something went wrong. Try again.",
        }));
        return null;
      }
    },
    [merge],
  );

  const upload = (card: "import" | "csv", path: string, file: File) => {
    const tooLarge = uploadSizeError(
      [file],
      card === "import" ? limits.archiveBytes : limits.csvBytes,
    );
    if (tooLarge) {
      setErrors((current) => ({ ...current, [card]: tooLarge }));
      return;
    }
    const body = new FormData();
    body.append("file", file);
    setUploading(card);
    void run(card, () => request(path, { method: "POST", body })).then((job) => {
      setUploading(null);
      if (!job) return;
      if (card === "import") setImportJobId(job.id);
      else setCsvJobId(job.id);
    });
  };

  const json = (value: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

  const discard = (card: "import" | "csv", job: MigrationJobJson | undefined) => {
    setErrors((current) => ({ ...current, [card]: null }));
    if (job?.status !== "ready") return;
    setJobs((current) => current.filter((existing) => existing.id !== job.id));
    request(`/jobs/${job.id}`, { method: "DELETE" }).catch((error: unknown) => {
      setErrors((current) => ({
        ...current,
        [card]: error instanceof Error ? error.message : "Something went wrong. Try again.",
      }));
    });
  };

  const importJob = jobs.find((job) => job.id === importJobId);
  const csvJob = jobs.find((job) => job.id === csvJobId);
  const importStage: ImportArchiveStage =
    uploading === "import" ? { kind: "uploading" } : archiveStage(importJob);
  const membersStage: MembersCsvStage =
    uploading === "csv" ? { kind: "uploading" } : csvStage(csvJob);
  const imported = jobs.some((job) => job.kind === "import" && job.status === "succeeded");
  const exports = useMemo(() => exportItems(slug, jobs), [slug, jobs]);
  const history = useMemo(() => importHistory(slug, jobs), [slug, jobs]);

  return (
    <>
      {platformImport}
      <MembersCsvCard
        stage={membersStage}
        error={errors.csv}
        onFile={(file) => upload("csv", "/members-csv", file)}
        {...importEmailHandlers(base, csvJobId)}
        onConfirm={(options) => {
          if (!csvJobId) return;
          void run("csv", () => request(`/members-csv/${csvJobId}/confirm`, json(options)));
        }}
        onRetry={() => {
          if (!csvJobId) return;
          void run("csv", () => request(`/jobs/${csvJobId}/retry`, { method: "POST" }));
        }}
        onReset={() => {
          setCsvJobId(null);
          discard("csv", csvJob);
        }}
      />
      <ImportHistory
        items={history}
        formatDate={formatDate}
        onSendEmails={async (jobId) => {
          merge(migrationJobJsonSchema.parse(await sendImportEmails(base, jobId)));
        }}
      />
      {subscribers ? (
        <ExistingSubscribersCard
          href={subscribers.href}
          connected={subscribers.connected}
          linking={subscribers.linking}
        />
      ) : null}
      <div className="flex flex-col gap-1 pt-2">
        <h3 className="text-lg font-semibold text-text">Cohory archives</h3>
        <p className="text-sm text-text-muted">
          Back up this community, or move it between Cohory servers.
        </p>
      </div>
      <ExportArchiveCard
        jobs={exports}
        starting={starting}
        error={errors.export}
        formatDate={formatDate}
        deletingId={deletingId}
        onStart={() => {
          setStarting(true);
          void run("export", () => request("/exports", { method: "POST" })).then(() =>
            setStarting(false),
          );
        }}
        onDelete={(id) => {
          setDeletingId(id);
          void run("export", () => request(`/exports/${id}`, { method: "DELETE" })).then(() =>
            setDeletingId(null),
          );
        }}
      />
      <ImportArchiveCard
        stage={importStage}
        available={importAvailable && !imported}
        unavailableReason={imported ? importedReason : importUnavailableReason}
        error={errors.import}
        formatDate={formatDate}
        onFile={(file) => upload("import", "/imports", file)}
        {...importEmailHandlers(base, importJobId)}
        onConfirm={(options) => {
          if (!importJobId) return;
          void run("import", () => request(`/imports/${importJobId}/confirm`, json(options)));
        }}
        onRetry={() => {
          if (!importJobId) return;
          void run("import", () => request(`/jobs/${importJobId}/retry`, { method: "POST" }));
        }}
        onReset={() => {
          setImportJobId(null);
          discard("import", importJob);
        }}
      />
    </>
  );
}
