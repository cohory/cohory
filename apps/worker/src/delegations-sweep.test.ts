import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createDelegationsSweepHandler,
  DELEGATIONS_SWEEP,
  type SweepDelegations,
} from "./jobs/delegations-sweep";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000031",
  name: DELEGATIONS_SWEEP,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("entitlements.delegations_sweep job", () => {
  it("runs once a day with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(DELEGATIONS_SWEEP, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(DELEGATIONS_SWEEP, "20 3 * * *");
  });

  it("runs one sweep per job and lets failures reject", async () => {
    const run = vi.fn<SweepDelegations>().mockResolvedValue({ ended: 2, noticesSent: 1 });
    await createDelegationsSweepHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<SweepDelegations>().mockRejectedValue(new Error("db down"));
    await expect(createDelegationsSweepHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
