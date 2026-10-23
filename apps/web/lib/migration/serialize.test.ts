import type { MigrationJobView } from "@cohory/migration";
import { describe, expect, it } from "vitest";

import { migrationJobJson } from "./serialize";

describe("migrationJobJson", () => {
  it("keeps the email choice and when the emails went out, so Import history can offer to send", () => {
    const at = new Date("2026-10-23T10:00:00.000Z");
    const view: MigrationJobView = {
      id: "01900000-0000-7000-8000-000000000001",
      kind: "import",
      status: "succeeded",
      fileName: null,
      fileBytes: null,
      progress: null,
      preview: null,
      summary: null,
      errorCode: null,
      downloadable: false,
      createdAt: at,
      startedAt: null,
      finishedAt: at,
      expiresAt: null,
      deletedAt: null,
      emailChoice: "later",
      emailsSentAt: null,
    };

    expect(migrationJobJson(view)).toMatchObject({ emailChoice: "later", emailsSentAt: null });
    expect(migrationJobJson({ ...view, emailsSentAt: at }).emailsSentAt).toBe(
      "2026-10-23T10:00:00.000Z",
    );
  });
});
