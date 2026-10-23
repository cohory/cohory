import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  APPROVALS_EXPIRY,
  createApprovalsExpiryHandler,
  type ExpireApprovals,
} from "./jobs/approvals-expiry";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000021",
  name: APPROVALS_EXPIRY,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("approvals.expiry job", () => {
  it("runs every five minutes with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(APPROVALS_EXPIRY, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(APPROVALS_EXPIRY, "*/5 * * * *");
  });

  it("runs one expiry pass per job and lets failures reject", async () => {
    const run = vi.fn<ExpireApprovals>().mockResolvedValue({ expired: 3, interrupted: 0 });
    await createApprovalsExpiryHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<ExpireApprovals>().mockRejectedValue(new Error("db down"));
    await expect(createApprovalsExpiryHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
