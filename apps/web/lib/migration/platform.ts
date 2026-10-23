import type { PlatformImportPreview, PlatformImportStage, PlatformSourceOption } from "@cohory/ui";
import { z } from "zod";

import { archiveStage, canRetry, jobErrorMessage, type MigrationJobJson } from "./jobs";

const sourceSchema = z.object({
  importer: z.object({ id: z.enum(["skool", "circle"]), version: z.string() }),
  name: z.string(),
  limitsPath: z.string(),
  files: z.array(
    z.object({
      name: z.string(),
      kind: z.string().nullable(),
      label: z.string(),
      rows: z.number(),
    }),
  ),
  warnings: z.array(z.string()),
  skipped: z.array(
    z.object({
      file: z.string(),
      row: z.string(),
      reason: z.string(),
      values: z.record(z.string(), z.string()).optional(),
    }),
  ),
  skippedTotal: z.number(),
  unknownColumns: z.array(z.object({ file: z.string(), columns: z.array(z.string()) })),
  overMemberLimit: z.boolean(),
  formerMemberAuthors: z.number().default(0),
  ambiguousAuthors: z
    .array(
      z.object({
        name: z.string(),
        placeholderId: z.string(),
        candidates: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
      }),
    )
    .default([]),
  dateOrder: z.enum(["dmy", "mdy"]).nullable().default(null),
  suggestedImporter: z.enum(["skool", "circle"]).nullable().default(null),
  mapping: z
    .object({
      roles: z.array(
        z.object({
          name: z.string(),
          email: z.string(),
          role: z.enum(["admin", "moderator"]),
          sourceRole: z.string().nullable(),
        }),
      ),
      rolesTotal: z.number(),
      categories: z.array(
        z.object({ source: z.string(), target: z.string().nullable(), existing: z.boolean() }),
      ),
      sample: z
        .object({
          title: z.string().nullable(),
          author: z.string(),
          category: z.string().nullable(),
          excerpt: z.string(),
        })
        .nullable(),
    })
    .default({ roles: [], rolesTotal: 0, categories: [], sample: null }),
});

const importerNames = { skool: "Skool", circle: "Circle" } as const;

const previewSchema = z.object({
  counts: z.record(z.string(), z.number()),
  people: z.object({
    total: z.number(),
    existing: z.number(),
    new: z.number(),
    keptApart: z.number().default(0),
    inviteOnly: z.boolean().optional(),
  }),
  warnings: z.array(z.string()),
  source: sourceSchema,
});

export function isPlatformJob(job: MigrationJobJson): boolean {
  return job.kind === "import" && sourceSchema.safeParse(job.preview?.["source"]).success;
}

export function platformPreview(job: MigrationJobJson): PlatformImportPreview | null {
  const parsed = previewSchema.safeParse(job.preview);
  if (!parsed.success) return null;
  const { source } = parsed.data;
  return {
    sourceName: source.name,
    version: source.importer.version,
    limitsHref: source.limitsPath,
    files: source.files.map((file) => ({
      name: file.name,
      label: file.label,
      recognized: file.kind !== null,
      rows: file.rows,
    })),
    counts: parsed.data.counts,
    people: parsed.data.people,
    formerMemberAuthors: source.formerMemberAuthors,
    ambiguousAuthors: source.ambiguousAuthors,
    dateOrder: source.dateOrder,
    suggestedSource: source.suggestedImporter
      ? { id: source.suggestedImporter, name: importerNames[source.suggestedImporter] }
      : null,
    mapping: source.mapping,
    warnings: parsed.data.warnings,
    skipped: source.skipped,
    skippedTotal: source.skippedTotal,
    unknownColumns: source.unknownColumns,
    overMemberLimit: source.overMemberLimit,
  };
}

export function platformStage(job: MigrationJobJson | undefined): PlatformImportStage {
  if (!job) return { kind: "idle" };
  if (job.status === "ready") {
    const preview = platformPreview(job);
    return preview ? { kind: "preview", preview } : { kind: "idle" };
  }
  if (job.status === "failed") {
    return { kind: "failed", message: jobErrorMessage(job.errorCode), canRetry: canRetry(job) };
  }
  const stage = archiveStage(job);
  return stage.kind === "preview" || stage.kind === "uploading" ? { kind: "idle" } : stage;
}

export interface ImporterCatalogEntry {
  readonly id: "skool" | "circle";
  readonly name: string;
  readonly version: string;
  readonly accept: readonly string[];
  readonly limitsPath: string;
  readonly files: readonly { readonly label: string; readonly description: string }[];
}

export function sourceOptions(entries: readonly ImporterCatalogEntry[]): PlatformSourceOption[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    accept: entry.accept.join(","),
    limitsHref: entry.limitsPath,
    files: entry.files,
  }));
}
