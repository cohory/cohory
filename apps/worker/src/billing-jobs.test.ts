import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  BILLING_INVOICE,
  BILLING_RECONCILE,
  createBillingInvoiceHandler,
  createBillingReconcileHandler,
  type GenerateInvoices,
  type ReconcileBilling,
} from "./jobs/billing";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000021",
  name: BILLING_INVOICE,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("platform billing jobs", () => {
  it("invoices on the first day of the month and reconciles daily, one run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(
      BILLING_INVOICE,
      expect.objectContaining({ policy: "stately" }),
    );
    expect(schedule).toHaveBeenCalledWith(BILLING_INVOICE, "15 0 1 * *");
    expect(createQueue).toHaveBeenCalledWith(BILLING_RECONCILE, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(BILLING_RECONCILE, "30 3 * * *");
  });

  it("runs one invoice pass per job and lets failures reject so pg-boss retries", async () => {
    const run = vi.fn<GenerateInvoices>().mockResolvedValue({
      period: "2026-10",
      created: 1,
      carriedForward: 0,
      pushed: 1,
      failed: 0,
    });
    await createBillingInvoiceHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<GenerateInvoices>().mockRejectedValue(new Error("stripe down"));
    await expect(createBillingInvoiceHandler(silentLogger, failing)([job])).rejects.toThrow(
      "stripe down",
    );
  });

  it("runs one reconciliation per job", async () => {
    const run = vi
      .fn<ReconcileBilling>()
      .mockResolvedValue({ synced: 2, checked: 3, issues: 1, failed: 0 });
    await createBillingReconcileHandler(silentLogger, run)([{ ...job, name: BILLING_RECONCILE }]);
    expect(run).toHaveBeenCalledOnce();
  });
});
