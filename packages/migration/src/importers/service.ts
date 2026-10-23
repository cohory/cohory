import { newId, type Community } from "@cohory/db";
import { categories } from "@cohory/db/schema";
import { asc } from "drizzle-orm";

import { MigrationError } from "../errors";
import { readArchive, writeArchive, type ParsedArchive } from "../format/archive";
import type { Runtime } from "../runtime";
import { inMigrationScope } from "../scope";
import type { ImportPreview, PlatformImportSource } from "../views";
import { importerCatalog, importerMaxBytes, importerMaxFiles, type ImporterId } from "./catalog";
import { detectSource, getImporter } from "./index";
import { readJson } from "./tabular";
import type { ImportFile, ImportReport } from "./types";

export interface BuiltPlatformImport {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly archive: ParsedArchive;
  readonly report: ImportReport;
}

export function assertImportFiles(files: readonly ImportFile[]): void {
  if (files.length === 0) {
    throw new MigrationError("validation_failed", "Choose at least one file.", [
      { path: "files", message: "Choose at least one file." },
    ]);
  }
  if (files.length > importerMaxFiles) {
    throw new MigrationError("validation_failed", `Choose up to ${importerMaxFiles} files.`, [
      { path: "files", message: `Choose up to ${importerMaxFiles} files.` },
    ]);
  }
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > importerMaxBytes) {
    throw new MigrationError("archive_too_large", "The files are larger than 25 MB together.");
  }
}

function fileProblems(
  files: readonly ImportFile[],
  report: ImportReport,
  platform: string,
): string[] {
  return report.files.flatMap((entry) => {
    if (entry.kind !== null) return entry.rows === 0 ? [`${entry.name} has no rows.`] : [];
    const file = files.find((candidate) => candidate.name === entry.name);
    if (file && /\.json$/i.test(file.name)) {
      try {
        readJson(file);
      } catch (error: unknown) {
        if (error instanceof MigrationError) return [error.message];
        throw error;
      }
    }
    return [`${entry.name} is not a ${platform} export file.`];
  });
}

export async function buildPlatformImport(
  runtime: Runtime,
  community: Community,
  importerId: ImporterId,
  files: readonly ImportFile[],
): Promise<BuiltPlatformImport> {
  assertImportFiles(files);
  const existingCategories = await inMigrationScope(runtime.db, community.id, ({ tx, where }) =>
    tx
      .select({
        slug: categories.slug,
        name: categories.name,
        color: categories.color,
        position: categories.position,
        staffOnly: categories.staffOnly,
      })
      .from(categories)
      .where(where(categories))
      .orderBy(asc(categories.position)),
  );
  const now = runtime.now();
  const parsed = getImporter(importerId).parse(files, {
    community: { id: community.id, slug: community.slug, name: community.name },
    existingCategories,
    now,
    newId,
  });
  const guess = detectSource(files);
  const report: ImportReport =
    guess.importer && guess.importer !== importerId
      ? {
          ...parsed.report,
          suggestedImporter: guess.importer,
          warnings: [
            `These files look like a ${importerCatalog[guess.importer].name} export. Choose ${importerCatalog[guess.importer].name} as the platform if that is where they come from.`,
            ...parsed.report.warnings,
          ],
        }
      : parsed.report;
  const { records } = parsed;
  if (records.memberships.length === 0 && records.posts.length === 0) {
    const problems = fileProblems(files, parsed.report, importerCatalog[importerId].name);
    throw new MigrationError(
      "validation_failed",
      `Nothing in these files can be imported from ${importerCatalog[importerId].name}. ${
        problems.length > 0 ? problems.join(" ") : "Check that you chose the export files."
      }`,
      [{ path: "files", message: "No members or posts were found." }],
    );
  }
  const bytes = writeArchive({
    meta: {
      edition: runtime.fairUse.edition,
      exportedAt: now,
      community: { id: community.id, slug: community.slug, name: community.name },
      missingUploads: [],
    },
    records,
    uploads: new Map(),
  });
  const archive = readArchive(bytes, {
    maxBytes: runtime.config.archiveMaxBytes,
    maxUploadBytes: runtime.config.archiveMaxBytes,
  });
  const date = now.toISOString().slice(0, 10);
  return { bytes, archive, report, fileName: `${importerId}-import-${date}.zip` };
}

export function sourceOf(preview: ImportPreview | null): PlatformImportSource | null {
  return preview?.source ?? null;
}
