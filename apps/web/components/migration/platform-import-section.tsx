"use client";

import { PlatformImportCard, type PlatformSourceOption } from "@cohory/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import {
  isActive,
  migrationJobJsonSchema,
  uploadSizeError,
  type MigrationJobJson,
} from "../../lib/migration/jobs";
import { importEmailHandlers } from "../../lib/migration/import-emails";
import { platformStage } from "../../lib/migration/platform";
import { useRefreshAfterSuccess } from "./use-refresh-after-success";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });
const pollMs = 2000;

export interface PlatformImportSectionProps {
  readonly slug: string;
  readonly sources: readonly PlatformSourceOption[];
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly initialJob: MigrationJobJson | null;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export function PlatformImportSection({
  slug,
  sources,
  maxFiles,
  maxBytes,
  initialJob,
  available,
  unavailableReason,
}: PlatformImportSectionProps) {
  const base = `/api/v1/communities/${encodeURIComponent(slug)}/manage/migration`;
  const [selected, setSelected] = useState<PlatformSourceOption["id"]>(sources[0]?.id ?? "skool");
  const [job, setJob] = useState<MigrationJobJson | null>(initialJob);
  const [uploading, setUploading] = useState(false);
  const [lastFiles, setLastFiles] = useState<readonly File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (path: string, init: RequestInit = {}): Promise<MigrationJobJson> => {
      const response = await fetch(`${base}${path}`, { credentials: "same-origin", ...init });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = errorSchema.safeParse(json);
        throw new Error(
          parsed.success ? parsed.data.error.message : "Something went wrong. Try again.",
        );
      }
      return migrationJobJsonSchema.parse(json);
    },
    [base],
  );

  const run = useCallback(async (work: () => Promise<MigrationJobJson>) => {
    setError(null);
    try {
      setJob(await work());
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
  }, []);

  const jobs = useMemo(() => (job ? [job] : []), [job]);
  useRefreshAfterSuccess(slug, jobs);

  const jobId = job?.id ?? null;
  const polling = job ? isActive(job) : false;
  useEffect(() => {
    if (!polling || !jobId) return;
    const timer = setInterval(() => {
      request(`/jobs/${jobId}`)
        .then(setJob)
        .catch(() => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [polling, jobId, request]);

  const json = (value: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

  const imported = job?.status === "succeeded";

  const discard = (stale: MigrationJobJson | null) => {
    if (stale?.status !== "ready") return;
    fetch(`${base}/jobs/${stale.id}`, { method: "DELETE", credentials: "same-origin" }).catch(
      () => undefined,
    );
  };

  const upload = (source: PlatformSourceOption["id"], files: readonly File[]) => {
    const tooLarge = uploadSizeError(files, maxBytes);
    if (tooLarge) {
      setError(tooLarge);
      return;
    }
    discard(job);
    const body = new FormData();
    for (const file of files) body.append("files", file);
    setLastFiles(files);
    setUploading(true);
    void run(() => request(`/importers/${source}/uploads`, { method: "POST", body })).finally(() =>
      setUploading(false),
    );
  };

  return (
    <PlatformImportCard
      sources={sources}
      selected={selected}
      stage={uploading ? { kind: "uploading" } : platformStage(job ?? undefined)}
      available={available}
      unavailableReason={unavailableReason}
      error={error}
      maxFiles={maxFiles}
      onSelect={setSelected}
      onFiles={(files) => upload(selected, files)}
      {...importEmailHandlers(base, jobId)}
      {...(lastFiles.length > 0
        ? {
            onSwitchSource: (source: PlatformSourceOption["id"]) => {
              setSelected(source);
              upload(source, lastFiles);
            },
          }
        : {})}
      onConfirm={(options) => {
        if (!jobId) return;
        void run(() => request(`/imports/${jobId}/confirm`, json(options)));
      }}
      onRetry={() => {
        if (!jobId) return;
        void run(() => request(`/jobs/${jobId}/retry`, { method: "POST" }));
      }}
      onReset={() => {
        setError(null);
        if (imported) {
          window.location.reload();
          return;
        }
        discard(job);
        setJob(null);
      }}
    />
  );
}
