import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_PURGE,
  createAccountPurgeHandler,
  type PurgeDueAccounts,
} from "./jobs/account-purge";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000003",
  name: ACCOUNT_PURGE,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("identity.account-purge job", () => {
  it("runs hourly with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(ACCOUNT_PURGE, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(ACCOUNT_PURGE, "17 * * * *");
  });

  it("runs one purge pass per job and lets failures reject", async () => {
    const run = vi.fn<PurgeDueAccounts>().mockResolvedValue({ erased: 1, blocked: 0 });
    await createAccountPurgeHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<PurgeDueAccounts>().mockRejectedValue(new Error("db down"));
    await expect(createAccountPurgeHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
