import type { Actor } from "@cohory/authz";
import { DataExportNotFoundError } from "@cohory/identity";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it, vi } from "vitest";

import { downloadDataExport, type DataExportOpener } from "./data-export-download";

const ada: Actor = { kind: "user", userId: "user-ada", platformAdmin: false };

function limiter(max: number) {
  return createRateLimiter({
    disabled: false,
    rules: { ...rateLimitDefaults, dataExportDownload: { max, windowSeconds: 3600 } },
  });
}

function opener(): DataExportOpener & { openExport: ReturnType<typeof vi.fn> } {
  return {
    openExport: vi.fn<DataExportOpener["openExport"]>(async () => ({
      filename: "data-export-2026-10-22.zip",
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([80, 75]));
          controller.close();
        },
      }),
    })),
  };
}

describe("downloadDataExport", () => {
  it("sends a signed out visitor to sign in without opening the export", async () => {
    const exports = opener();

    const result = await downloadDataExport(null, "export-1", { exports, limiter: limiter(5) });

    expect(result).toEqual({ kind: "sign_in" });
    expect(exports.openExport).not.toHaveBeenCalled();
  });

  it("streams the ZIP to the signed in owner without caching it", async () => {
    const exports = opener();

    const result = await downloadDataExport(ada, "export-1", { exports, limiter: limiter(5) });

    expect(exports.openExport).toHaveBeenCalledWith(ada, "export-1");
    if (result.kind !== "file") throw new Error(`expected a file, got ${result.kind}`);
    expect(result.response.headers.get("content-type")).toBe("application/zip");
    expect(result.response.headers.get("content-disposition")).toBe(
      'attachment; filename="data-export-2026-10-22.zip"',
    );
    expect(result.response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(new Uint8Array([80, 75]));
  });

  it("limits how often one account can download, before building anything", async () => {
    const exports = opener();
    const deps = { exports, limiter: limiter(2) };

    await downloadDataExport(ada, "export-1", deps);
    await downloadDataExport(ada, "export-1", deps);
    const third = await downloadDataExport(ada, "export-1", deps);

    expect(third).toEqual({ kind: "rate_limited", retryAfterSeconds: expect.any(Number) });
    expect(exports.openExport).toHaveBeenCalledTimes(2);
  });

  it("treats an unknown or expired export as expired", async () => {
    const exports = opener();
    exports.openExport.mockRejectedValue(new DataExportNotFoundError());

    const result = await downloadDataExport(ada, "export-1", { exports, limiter: limiter(5) });

    expect(result).toEqual({ kind: "expired" });
  });
});
