import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createHoldsExpiryHandler,
  PAYMENTS_HOLDS_EXPIRY,
  type ExpireHolds,
} from "./jobs/payments-holds-expiry";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000037",
  name: PAYMENTS_HOLDS_EXPIRY,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("payments.holds-expiry job", () => {
  it("runs hourly with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_HOLDS_EXPIRY, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_HOLDS_EXPIRY, "23 * * * *");
  });

  it("runs one hold release pass per job and lets failures reject", async () => {
    const run = vi.fn<ExpireHolds>().mockResolvedValue({ released: 2, kept: 1, failed: 0 });
    await createHoldsExpiryHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<ExpireHolds>().mockRejectedValue(new Error("db down"));
    await expect(createHoldsExpiryHandler(silentLogger, failing)([job])).rejects.toThrow("db down");
  });
});
