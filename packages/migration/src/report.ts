import { csvRow } from "./format/csv";
import type { MigrationJobView } from "./views";

export interface MigrationReport {
  readonly filename: string;
  readonly csv: string;
}

type Line = readonly [type: string, name: string, value: string | number | null, detail?: string];

type ReportJob = Exclude<MigrationJobView, { kind: "export" }>;

function sourceOf(job: ReportJob): { id: string; name: string } {
  if (job.kind === "members_csv") return { id: "members-csv", name: "Members CSV" };
  const source = job.preview?.source;
  return source
    ? { id: source.importer.id, name: source.name }
    : { id: "archive", name: "Cohory archive" };
}

function summaryLines(job: ReportJob): Line[] {
  if (job.kind === "members_csv") {
    const summary = job.summary;
    if (!summary) return [];
    return [
      ["members", "added", summary.added],
      ["members", "invited", summary.invited],
      ["emails", "sent", summary.emailsSent],
      ["skipped", "total", summary.skipped],
    ];
  }
  const summary = job.summary;
  if (!summary) return [];
  return [
    ...Object.entries(summary.imported)
      .filter(([, count]) => count > 0)
      .map(([entity, count]): Line => ["imported", entity, count]),
    ["accounts", "created", summary.users.created],
    ["accounts", "linked", summary.users.linked],
    ["emails", "sent", summary.emailsSent],
    ["skipped", "total", summary.skippedTotal],
    ...summary.skipped.map((row): Line => ["skipped", row.entity, row.sourceId, row.reason]),
    ...(summary.warnings ?? []).map((warning): Line => ["warning", "", null, warning]),
  ];
}

export function buildImportReport(job: ReportJob): MigrationReport {
  const source = sourceOf(job);
  const at = (job.finishedAt ?? job.createdAt).toISOString().slice(0, 10);
  const lines: Line[] = [
    ["source", source.name, null],
    ["status", job.status, null, job.errorCode ?? undefined],
    ...summaryLines(job),
  ];
  const csv = [
    csvRow(["type", "name", "value", "detail"]),
    ...lines.map(([type, name, value, detail]) => csvRow([type, name, value, detail ?? null])),
  ].join("");
  return { filename: `${source.id}-import-report-${at}.csv`, csv };
}
