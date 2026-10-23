import { describe, expect, it } from "vitest";

import {
  archiveStage,
  csvStage,
  exportItems,
  importHistory,
  jobErrorMessage,
  uploadSizeError,
  type MigrationJobJson,
} from "./jobs";

function job(overrides: Partial<MigrationJobJson>): MigrationJobJson {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    kind: "export",
    status: "queued",
    fileName: null,
    fileBytes: null,
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

describe("migration job views", () => {
  it("offers Retry only while the stored file and rows are still there", () => {
    const failed = { status: "failed" as const, errorCode: "internal_error" };
    const now = Date.parse("2026-10-20T10:00:00.000Z");

    expect(archiveStage(job({ kind: "import", ...failed }), now)).toMatchObject({ canRetry: true });
    expect(
      archiveStage(job({ kind: "import", ...failed, deletedAt: "2026-10-19T10:00:00.000Z" }), now),
    ).toMatchObject({ canRetry: false });
    expect(
      archiveStage(job({ kind: "import", ...failed, expiresAt: "2026-10-19T10:00:00.000Z" }), now),
    ).toMatchObject({ canRetry: false });
    const cleared = { totals: { rows: 2 }, rows: [] };
    expect(csvStage(job({ kind: "members_csv", ...failed, preview: cleared }), now)).toMatchObject({
      kind: "failed",
      canRetry: false,
    });
  });

  it("links only finished exports and explains failures", () => {
    const items = exportItems("makers", [
      job({ status: "succeeded", downloadable: true, fileBytes: 10 }),
      job({
        id: "01900000-0000-7000-8000-000000000002",
        status: "failed",
        errorCode: "archive_too_large",
      }),
      job({ kind: "import" }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.downloadHref).toBe(
      "/api/v1/communities/makers/manage/migration/exports/01900000-0000-7000-8000-000000000001/download",
    );
    expect(items[1]?.errorMessage).toBe("The archive is larger than this server allows.");
  });

  it("shows what an export holds, how long it is kept, and when it was deleted", () => {
    const [kept, deleted] = exportItems("makers", [
      job({
        status: "succeeded",
        downloadable: true,
        expiresAt: "2026-11-17T10:00:00.000Z",
        summary: { counts: { memberships: 312, posts: 40, comments: 1, courses: 0 } },
      }),
      job({
        id: "01900000-0000-7000-8000-000000000002",
        status: "succeeded",
        deletedAt: "2026-10-19T10:00:00.000Z",
        summary: { counts: { memberships: 1 } },
      }),
    ]);

    expect(kept).toMatchObject({
      contents: "312 members, 40 posts, 1 comment",
      expiresAt: "2026-11-17T10:00:00.000Z",
      deletedAt: null,
    });
    expect(deleted).toMatchObject({ downloadHref: null, deletedAt: "2026-10-19T10:00:00.000Z" });
  });

  it("lists finished imports with their source, counts, skipped rows, emails, and report", () => {
    const history = importHistory("makers", [
      job({ kind: "import", status: "ready" }),
      job({
        kind: "import",
        status: "succeeded",
        finishedAt: "2026-10-18T11:00:00.000Z",
        preview: { source: { name: "Skool" } },
        summary: {
          imported: { memberships: 3, posts: 3, comments: 4, reactions: 0 },
          skipped: [{ entity: "posts", sourceId: "p1", reason: "Empty post." }],
          skippedTotal: 2,
          emailsSent: 3,
        },
      }),
      job({
        id: "01900000-0000-7000-8000-000000000002",
        kind: "members_csv",
        status: "succeeded",
        summary: { mode: "invite", added: 0, invited: 5, skipped: 1, emailsSent: 5 },
      }),
      job({
        id: "01900000-0000-7000-8000-000000000003",
        kind: "import",
        status: "failed",
        errorCode: "internal_error",
      }),
      job({ kind: "export", status: "succeeded" }),
    ]);

    expect(history).toEqual([
      {
        id: "01900000-0000-7000-8000-000000000001",
        source: "Skool",
        status: "succeeded",
        at: "2026-10-18T11:00:00.000Z",
        counts: "3 members, 3 posts, 4 comments",
        skipped: 2,
        emailsSent: 3,
        emailsWaiting: false,
        errorMessage: null,
        reportHref:
          "/api/v1/communities/makers/manage/migration/jobs/01900000-0000-7000-8000-000000000001/report",
      },
      expect.objectContaining({
        source: "Members CSV",
        counts: "5 invited",
        skipped: 1,
        emailsSent: 5,
      }),
      expect.objectContaining({
        source: "Cohory archive",
        status: "failed",
        counts: null,
        errorMessage: "Something went wrong on our side. Try again.",
      }),
    ]);
  });

  it("offers to send the emails only for an import whose emails wait for the owner", () => {
    const finished = { kind: "import" as const, status: "succeeded" as const, summary: {} };
    const [waiting, sent, never] = importHistory("makers", [
      job({ ...finished, emailChoice: "later", emailsSentAt: null }),
      job({ ...finished, emailChoice: "later", emailsSentAt: "2026-10-19T10:00:00.000Z" }),
      job({ ...finished, emailChoice: "never", emailsSentAt: null }),
    ]);

    expect(waiting?.emailsWaiting).toBe(true);
    expect(sent?.emailsWaiting).toBe(false);
    expect(never?.emailsWaiting).toBe(false);
  });

  it("reports invited people, emails not sent, and the email choice of a finished import", () => {
    const stage = archiveStage(
      job({
        kind: "import",
        status: "succeeded",
        emailChoice: "now",
        summary: {
          imported: { memberships: 3 },
          users: { created: 0, linked: 0, invited: 3 },
          ownerImportedAs: "none",
          skipped: [],
          skippedTotal: 0,
          subscriptionLinks: [],
          emailsSent: 2,
          emailsNotSent: 1,
          emailsOverLimit: 4,
        },
      }),
    );

    expect(stage).toMatchObject({
      kind: "done",
      result: {
        invitedAccounts: 3,
        emailsSent: 2,
        emailsNotSent: 1,
        emailsOverLimit: 4,
        emailChoice: "now",
      },
    });
  });

  it("names the size limit before a large upload starts", () => {
    const file = (name: string, size: number) => ({ name, size });
    const mb = 1024 * 1024;

    expect(uploadSizeError([file("a.csv", 10 * mb)], 25 * mb)).toBeNull();
    expect(uploadSizeError([file("a.csv", 20 * mb), file("b.json", 8 * mb)], 25 * mb)).toBe(
      "These files are 28 MB together. The limit is 25 MB.",
    );
    expect(uploadSizeError([file("archive.zip", 3 * mb)], 2 * mb)).toBe(
      "archive.zip is 3 MB. The limit is 2 MB.",
    );
  });

  it("turns an import job into the card stage", () => {
    expect(archiveStage(undefined)).toEqual({ kind: "idle" });
    expect(archiveStage(job({ kind: "import", status: "running" }))).toEqual({
      kind: "running",
      progress: null,
    });
    expect(
      archiveStage(
        job({
          kind: "import",
          status: "running",
          startedAt: "2026-10-18T10:01:00.000Z",
          progress: { phase: "posts", done: 4, total: 10 },
        }),
      ),
    ).toEqual({
      kind: "running",
      progress: { phase: "posts", done: 4, total: 10, startedAt: "2026-10-18T10:01:00.000Z" },
    });
    expect(
      archiveStage(job({ kind: "import", status: "failed", errorCode: "checksum_mismatch" })),
    ).toMatchObject({
      kind: "failed",
      canRetry: true,
    });
    const preview = archiveStage(
      job({
        kind: "import",
        status: "ready",
        preview: {
          community: { id: "x", slug: "makers", name: "Makers" },
          exportedAt: "2026-10-18T10:00:00.000Z",
          schemaVersion: "1.0.0",
          cohoryVersion: "0.2.0",
          edition: "cloud",
          counts: { posts: 2 },
          people: { total: 2, existing: 1, new: 1 },
          uploads: { count: 3, bytes: 10 },
          warnings: [],
        },
      }),
    );
    expect(preview).toMatchObject({
      kind: "preview",
      preview: { communityName: "Makers", uploads: 3 },
    });
  });

  it("turns a finished members import into its result", () => {
    expect(
      csvStage(
        job({
          kind: "members_csv",
          status: "succeeded",
          summary: {
            mode: "add",
            added: 2,
            invited: 0,
            skipped: 1,
            emailsSent: 2,
            notSent: 1,
            limitReached: false,
            skippedRows: [{ line: 4, reason: "This is not a valid email address." }],
          },
        }),
      ),
    ).toEqual({
      kind: "done",
      result: {
        mode: "add",
        added: 2,
        invited: 0,
        skipped: 1,
        emailsSent: 2,
        notSent: 1,
        limitReached: false,
        skippedRows: [{ line: 4, reason: "This is not a valid email address." }],
      },
    });
  });

  it("falls back to a plain message for unknown errors", () => {
    expect(jobErrorMessage("weird")).toBe("Something went wrong. Try again.");
    expect(jobErrorMessage("invalid_csv")).toBe(
      "A file could not be read. Check the file and try again.",
    );
    expect(jobErrorMessage("job_in_progress")).toBe(
      "Another job is still running. Wait for it to finish.",
    );
  });
});
