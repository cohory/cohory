import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createOAuthClientsPruneHandler,
  OAUTH_CLIENTS_PRUNE,
  type PruneOAuthClients,
} from "./jobs/oauth-clients-prune";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000056",
  name: OAUTH_CLIENTS_PRUNE,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("agents.oauth_clients_prune job", () => {
  it("runs once a day with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(OAUTH_CLIENTS_PRUNE, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(OAUTH_CLIENTS_PRUNE, "55 3 * * *");
  });

  it("runs one prune per job, logs only counts, and lets failures reject", async () => {
    const info = vi.spyOn(silentLogger, "info");
    const run = vi.fn<PruneOAuthClients>().mockResolvedValue({ scanned: 3, pruned: 2 });
    await createOAuthClientsPruneHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      { jobId: job.id, job: OAUTH_CLIENTS_PRUNE, scanned: 3, pruned: 2 },
      "unused oauth clients pruned",
    );

    const failing = vi.fn<PruneOAuthClients>().mockRejectedValue(new Error("db down"));
    await expect(createOAuthClientsPruneHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
