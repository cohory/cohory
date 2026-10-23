import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createMigrationFilesExpiryHandler,
  createMigrationHandler,
  MIGRATION_EXPORT,
  MIGRATION_FILES_EXPIRY,
  MIGRATION_IMPORT,
} from "./jobs/migration";
import { registerJobs, type JobRegistry } from "./worker";

const logger = createLogger({ level: "silent" });
const payload = {
  jobId: "01900000-0000-7000-8000-000000000001",
  communityId: "01900000-0000-7000-8000-000000000002",
};

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000003",
    name: MIGRATION_EXPORT,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("migration jobs", () => {
  it("creates the export, import, members import, and import finished queues with retries", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      logger,
    );

    for (const name of [
      "migration.export",
      "migration.import",
      "migration.members-import",
      "migration.import-finished",
    ]) {
      expect(createQueue).toHaveBeenCalledWith(name, {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
      });
      expect(work).toHaveBeenCalledWith(name, expect.any(Function));
    }
  });

  it("deletes expired previews and export files once a day, one run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs(
      { createQueue, work: vi.fn().mockResolvedValue("id"), schedule } as JobRegistry,
      logger,
    );

    expect(createQueue).toHaveBeenCalledWith(MIGRATION_FILES_EXPIRY, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(MIGRATION_FILES_EXPIRY, "35 4 * * *");
  });

  it("runs one expiry sweep per job and lets failures reject", async () => {
    const run = vi.fn().mockResolvedValue({ previews: 1, files: 2 });
    await createMigrationFilesExpiryHandler(logger, run)([job(null)]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn().mockRejectedValue(new Error("storage down"));
    await expect(createMigrationFilesExpiryHandler(logger, failing)([job(null)])).rejects.toThrow(
      "storage down",
    );
  });

  it("passes the parsed payload to the runner for its queue", async () => {
    const run = vi.fn().mockResolvedValue("succeeded");

    await createMigrationHandler(logger, MIGRATION_IMPORT, run)([job(payload)]);

    expect(run).toHaveBeenCalledWith(MIGRATION_IMPORT, payload);
  });

  it("rejects a malformed payload so the job is retried and then fails", async () => {
    const run = vi.fn();

    await expect(
      createMigrationHandler(logger, MIGRATION_EXPORT, run)([job({ jobId: "x" })]),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
