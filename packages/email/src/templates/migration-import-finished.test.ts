import { describe, expect, it } from "vitest";

import {
  migrationExportReadyEmail,
  migrationImportFailedEmail,
  migrationImportFinishedEmail,
} from "./migration-import-finished";

const input = {
  name: "Olga",
  communityName: "Makers",
  source: "Skool",
  reportUrl: "https://cohory.test/api/v1/communities/makers/manage/migration/jobs/j1/report",
  migrationUrl: "https://cohory.test/c/makers/manage/migration",
};

describe("migrationImportFinishedEmail", () => {
  it("names the source and links to the report and the Migration page", () => {
    const email = migrationImportFinishedEmail(input);

    expect(email.template).toBe("migration-import-finished");
    expect(email.subject).toBe("[Makers] Your import is done");
    expect(email.text).toContain("The Skool import into Makers is done.");
    expect(email.text).toContain(`Download the report: ${input.reportUrl}`);
    expect(email.text).toContain(input.migrationUrl);
  });

  it("greets an owner whose name is an email address without repeating the address", () => {
    const email = migrationImportFinishedEmail({ ...input, name: "olga@example.test" });

    expect(email.text).not.toContain("olga@example.test");
  });

  it("escapes the community name in HTML", () => {
    const email = migrationImportFinishedEmail({ ...input, communityName: "<b>Makers</b>" });

    expect(email.html).not.toContain("<b>Makers</b>");
  });

  it("puts what moved in the preheader and the body", () => {
    const email = migrationImportFinishedEmail({
      ...input,
      outcome: "21 members, 10 posts moved. 3 rows skipped.",
    });

    expect(email.text).toContain("21 members, 10 posts moved. 3 rows skipped.");
  });
});

describe("migrationImportFailedEmail", () => {
  it("says the import stopped and links to Migration to try again", () => {
    const email = migrationImportFailedEmail({
      name: "Olga",
      communityName: "Makers",
      source: "Circle",
      migrationUrl: input.migrationUrl,
    });

    expect(email.template).toBe("migration-import-failed");
    expect(email.subject).toBe("[Makers] Your import stopped");
    expect(email.text).toContain("The Circle import into Makers stopped before it finished.");
    expect(email.text).toContain(`Open Migration: ${input.migrationUrl}`);
  });
});

describe("migrationImportFailedEmail for an export", () => {
  it("says the export stopped and asks for a new one", () => {
    const email = migrationImportFailedEmail({
      name: "Olga",
      communityName: "Makers",
      source: null,
      migrationUrl: input.migrationUrl,
    });

    expect(email.subject).toBe("[Makers] Your export stopped");
    expect(email.text).toContain("The export of Makers stopped before it finished.");
  });
});

describe("migrationExportReadyEmail", () => {
  it("links to the download and says how long it stays", () => {
    const email = migrationExportReadyEmail({
      name: "Olga",
      communityName: "Makers",
      downloadUrl:
        "https://cohory.test/api/v1/communities/makers/manage/migration/exports/j1/download",
      migrationUrl: input.migrationUrl,
      lifetimeDays: 30,
    });

    expect(email.template).toBe("migration-export-ready");
    expect(email.subject).toBe("[Makers] Your export is ready");
    expect(email.html).toContain("The download works for 30 days.");
    expect(email.text).toContain("Download the export: https://cohory.test/api/v1/");
  });
});
