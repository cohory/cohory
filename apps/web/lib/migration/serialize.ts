import type { MigrationJobView } from "@cohory/migration";

import type { MigrationJobJson } from "./jobs";

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function migrationJobJson(view: MigrationJobView): MigrationJobJson {
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    fileName: view.fileName,
    fileBytes: view.fileBytes,
    progress: view.progress ? { ...view.progress } : null,
    preview: view.preview ? { ...view.preview } : null,
    summary: view.summary ? { ...view.summary } : null,
    errorCode: view.errorCode,
    downloadable: view.downloadable,
    createdAt: view.createdAt.toISOString(),
    startedAt: iso(view.startedAt),
    finishedAt: iso(view.finishedAt),
    expiresAt: iso(view.expiresAt),
    deletedAt: iso(view.deletedAt),
    emailChoice: view.emailChoice,
    emailsSentAt: iso(view.emailsSentAt),
  };
}
