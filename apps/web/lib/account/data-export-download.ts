import type { Actor } from "@cohory/authz";
import { DataExportNotFoundError, type DataExportService } from "@cohory/identity";
import { RateLimitedError, type RateLimiter } from "@cohory/rate-limit";

export type DataExportOpener = Pick<DataExportService, "openExport">;

export interface DataExportDownloadDeps {
  readonly exports: DataExportOpener;
  readonly limiter: RateLimiter;
}

export type DataExportDownload =
  | { kind: "sign_in" }
  | { kind: "expired" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "file"; response: Response };

export async function downloadDataExport(
  actor: Actor | null,
  exportId: string,
  deps: DataExportDownloadDeps,
): Promise<DataExportDownload> {
  if (!actor || actor.kind !== "user") {
    return { kind: "sign_in" };
  }
  try {
    deps.limiter.consume("dataExportDownload", `data-export:${actor.userId}`);
    const file = await deps.exports.openExport(actor, exportId);
    return {
      kind: "file",
      response: new Response(file.stream, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${file.filename}"`,
          "cache-control": "private, no-store",
        },
      }),
    };
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
    }
    if (error instanceof DataExportNotFoundError) {
      return { kind: "expired" };
    }
    throw error;
  }
}
