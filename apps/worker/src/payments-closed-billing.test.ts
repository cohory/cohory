import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  closedBillingSweepCron,
  createClosedBillingSweepHandler,
  PAYMENTS_CLOSED_BILLING_SWEEP,
  type EndClosedBillingAccess,
} from "./jobs/payments-closed-billing";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000005",
  name: PAYMENTS_CLOSED_BILLING_SWEEP,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("payments.closed-billing-sweep job", () => {
  it("runs every 15 minutes with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(PAYMENTS_CLOSED_BILLING_SWEEP).toBe("payments.closed-billing-sweep");
    expect(closedBillingSweepCron).toBe("*/15 * * * *");
    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_CLOSED_BILLING_SWEEP, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_CLOSED_BILLING_SWEEP, "*/15 * * * *");
    expect(work).toHaveBeenCalledWith(PAYMENTS_CLOSED_BILLING_SWEEP, expect.any(Function));
  });

  it("runs one sweep per job and lets failures reject", async () => {
    const run = vi.fn<EndClosedBillingAccess>().mockResolvedValue({ ended: 3 });
    await createClosedBillingSweepHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<EndClosedBillingAccess>().mockRejectedValue(new Error("db down"));
    await expect(createClosedBillingSweepHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
