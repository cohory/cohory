import { describe, expect, it } from "vitest";

import type { MigrationJobJson } from "./jobs";
import { isPlatformJob, platformStage } from "./platform";

function job(overrides: Partial<MigrationJobJson>): MigrationJobJson {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    kind: "import",
    status: "ready",
    fileName: "skool-import.zip",
    fileBytes: 10,
    progress: null,
    preview: null,
    summary: null,
    errorCode: null,
    downloadable: false,
    createdAt: "2026-10-18T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const preview = {
  community: { id: "x", slug: "makers", name: "Makers" },
  exportedAt: "2026-10-18T10:00:00.000Z",
  schemaVersion: "1.0.0",
  edition: "cloud",
  counts: { memberships: 2, posts: 1 },
  people: { total: 2, existing: 0, new: 2 },
  uploads: { count: 0, bytes: 0 },
  warnings: ["A warning."],
  source: {
    importer: { id: "skool", version: "1.0.0" },
    name: "Skool",
    limitsPath: "/importers/skool",
    files: [{ name: "members.csv", kind: "members", label: "Members CSV", rows: 2 }],
    warnings: ["A warning."],
    skipped: [],
    skippedTotal: 0,
    unknownColumns: [],
    formerMemberAuthors: 0,
    overMemberLimit: false,
  },
};

describe("platform import stage", () => {
  it("tells platform imports apart from archive imports", () => {
    expect(isPlatformJob(job({ preview }))).toBe(true);
    expect(isPlatformJob(job({ preview: { ...preview, source: undefined } }))).toBe(false);
    expect(isPlatformJob(job({ kind: "export", preview }))).toBe(false);
  });

  it("maps a ready job to its preview with detected files", () => {
    expect(platformStage(job({ preview }))).toMatchObject({
      kind: "preview",
      preview: {
        sourceName: "Skool",
        limitsHref: "/importers/skool",
        files: [{ name: "members.csv", recognized: true, rows: 2 }],
      },
    });
  });

  it("reads previews saved before the mapping fields existed with safe defaults", () => {
    expect(platformStage(job({ preview }))).toMatchObject({
      preview: {
        people: { keptApart: 0 },
        ambiguousAuthors: [],
        dateOrder: null,
        suggestedSource: null,
        mapping: { roles: [], categories: [], sample: null },
      },
    });
  });

  it("names the platform the files seem to come from", () => {
    const suggested = {
      ...preview,
      source: { ...preview.source, suggestedImporter: "circle", dateOrder: "dmy" },
    };
    expect(platformStage(job({ preview: suggested }))).toMatchObject({
      preview: { suggestedSource: { id: "circle", name: "Circle" }, dateOrder: "dmy" },
    });
  });

  it("maps running, failed, and finished jobs", () => {
    expect(platformStage(job({ preview, status: "running" }))).toEqual({
      kind: "running",
      progress: null,
    });
    expect(platformStage(job({ preview, status: "failed", errorCode: "x" }))).toMatchObject({
      kind: "failed",
      canRetry: true,
    });
    expect(
      platformStage(
        job({ preview, status: "failed", errorCode: "x", deletedAt: "2026-10-19T10:00:00.000Z" }),
      ),
    ).toMatchObject({ kind: "failed", canRetry: false });
    expect(
      platformStage(
        job({
          preview,
          status: "succeeded",
          summary: {
            imported: { posts: 1 },
            users: { created: 2, linked: 0 },
            ownerImportedAs: "none",
            skipped: [
              {
                entity: "members.csv",
                sourceId: "line 5",
                reason: "The email is missing or not valid.",
                values: { Email: "" },
              },
            ],
            skippedTotal: 1,
            warnings: ["A warning."],
            subscriptionLinks: [],
            emailsSent: 0,
          },
        }),
      ),
    ).toMatchObject({
      kind: "done",
      result: {
        createdAccounts: 2,
        skippedTotal: 1,
        skipped: [{ entity: "members.csv", sourceId: "line 5" }],
        warnings: ["A warning."],
      },
    });
  });
});
