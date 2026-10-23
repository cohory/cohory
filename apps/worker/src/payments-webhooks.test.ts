import { reconcileConnectionQueueOptions, webhookEventQueueOptions } from "@cohory/payments";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createPaymentsReconcileConnectionHandler,
  createPaymentsReconcileHandler,
  PAYMENTS_RECONCILE,
  PAYMENTS_RECONCILE_CONNECTION,
  paymentsReconcileCron,
} from "./jobs/payments-reconcile";
import {
  createPaymentsBillingWebhookHandler,
  createPaymentsWebhookHandler,
  createPaymentsWebhookSweepHandler,
  PAYMENTS_BILLING_WEBHOOK_PROCESS,
  PAYMENTS_WEBHOOK_PROCESS,
  PAYMENTS_WEBHOOK_SWEEP,
  paymentsWebhookSweepCron,
} from "./jobs/payments-webhooks";
import type { JobDeps } from "./services";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });
const connectionId = "01900000-0000-7000-8000-000000000021";
const payload = {
  providerEventId: "01900000-0000-7000-8000-000000000022",
  connectionId,
};

function job(name: string, data: unknown, retryCount = 0): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000023",
    name,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount,
  } as Job<unknown>;
}

async function registered() {
  const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue("worker-id");
  const schedule = vi.fn().mockResolvedValue(undefined);
  await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);
  return { createQueue, work, schedule };
}

describe("payments.webhook.process job", () => {
  it("registers a queue that deduplicates queued events and retries with backoff", async () => {
    const { createQueue, work } = await registered();

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_WEBHOOK_PROCESS, {
      policy: "short",
      retryLimit: 10,
      retryDelay: 30,
      retryBackoff: true,
    });
    expect(webhookEventQueueOptions.retryLimit).toBe(10);
    expect(work).toHaveBeenCalledWith(PAYMENTS_WEBHOOK_PROCESS, expect.any(Function));
  });

  it("processes the stored event named by the payload", async () => {
    const process = vi.fn<JobDeps["processPaymentWebhook"]>().mockResolvedValue("processed");

    await createPaymentsWebhookHandler(
      silentLogger,
      process,
    )([job(PAYMENTS_WEBHOOK_PROCESS, payload)]);

    expect(process).toHaveBeenCalledWith(payload);
  });

  it("fails the job so pg-boss retries it when processing fails", async () => {
    const process = vi
      .fn<JobDeps["processPaymentWebhook"]>()
      .mockRejectedValue(new Error("stripe is down"));

    await expect(
      createPaymentsWebhookHandler(silentLogger, process)([job(PAYMENTS_WEBHOOK_PROCESS, payload)]),
    ).rejects.toThrow("stripe is down");
  });

  it("logs once at error level, by ids only, when the last retry fails", async () => {
    const logger = createLogger({ level: "silent" });
    const error = vi.spyOn(logger, "error");
    const process = vi
      .fn<JobDeps["processPaymentWebhook"]>()
      .mockRejectedValue(new Error("stripe is down"));
    const handler = createPaymentsWebhookHandler(logger, process);

    await expect(handler([job(PAYMENTS_WEBHOOK_PROCESS, payload, 9)])).rejects.toThrow();
    expect(error).not.toHaveBeenCalled();
    await expect(
      handler([job(PAYMENTS_WEBHOOK_PROCESS, payload, webhookEventQueueOptions.retryLimit)]),
    ).rejects.toThrow("stripe is down");

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ ...payload, error: "Error" }),
      "payment webhook retries exhausted; the hourly sweep re-queues it for up to 3 days",
    );
  });

  it("rejects a payload that carries more than ids", async () => {
    const process = vi.fn<JobDeps["processPaymentWebhook"]>();

    await expect(
      createPaymentsWebhookHandler(
        silentLogger,
        process,
      )([job(PAYMENTS_WEBHOOK_PROCESS, { ...payload, event: { id: "evt_1" } })]),
    ).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
  });

  it("rejects a payload without a stored event id", async () => {
    const process = vi.fn<JobDeps["processPaymentWebhook"]>();

    await expect(
      createPaymentsWebhookHandler(
        silentLogger,
        process,
      )([job(PAYMENTS_WEBHOOK_PROCESS, { ...payload, providerEventId: "evt_1" })]),
    ).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
  });
});

describe("payments.billing-webhook.process job", () => {
  it("registers the queue with the webhook retry options", async () => {
    const { createQueue, work } = await registered();

    expect(createQueue).toHaveBeenCalledWith(
      PAYMENTS_BILLING_WEBHOOK_PROCESS,
      webhookEventQueueOptions,
    );
    expect(work).toHaveBeenCalledWith(PAYMENTS_BILLING_WEBHOOK_PROCESS, expect.any(Function));
  });

  it("processes the stored platform billing event named by the payload", async () => {
    const process = vi.fn<JobDeps["processBillingWebhook"]>().mockResolvedValue("processed");
    const billing = { providerEventId: payload.providerEventId };

    await createPaymentsBillingWebhookHandler(
      silentLogger,
      process,
    )([job(PAYMENTS_BILLING_WEBHOOK_PROCESS, billing)]);

    expect(process).toHaveBeenCalledWith(billing);
  });
});

describe("payments.webhook-sweep job", () => {
  it("runs the sweep every hour", async () => {
    const { createQueue, schedule } = await registered();

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_WEBHOOK_SWEEP, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_WEBHOOK_SWEEP, paymentsWebhookSweepCron);
    expect(paymentsWebhookSweepCron).toBe("17 * * * *");
  });

  it("asks the service to re-queue stale events", async () => {
    const sweep = vi
      .fn<JobDeps["sweepWebhookEvents"]>()
      .mockResolvedValue({ requeued: 1, abandoned: 0 });

    await createPaymentsWebhookSweepHandler(silentLogger, sweep)([job(PAYMENTS_WEBHOOK_SWEEP, {})]);

    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe("payments reconciliation jobs", () => {
  it("schedules the sweep daily and registers the per connection queue", async () => {
    const { createQueue, work, schedule } = await registered();

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_RECONCILE, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_RECONCILE, paymentsReconcileCron);
    expect(createQueue).toHaveBeenCalledWith(
      PAYMENTS_RECONCILE_CONNECTION,
      reconcileConnectionQueueOptions,
    );
    expect(work).toHaveBeenCalledWith(PAYMENTS_RECONCILE_CONNECTION, expect.any(Function));
  });

  it("asks the service to schedule one job per connection", async () => {
    const run = vi
      .fn<JobDeps["scheduleConnectionReconciles"]>()
      .mockResolvedValue({ scheduled: 2 });

    await createPaymentsReconcileHandler(silentLogger, run)([job(PAYMENTS_RECONCILE, {})]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reconciles the connection named by the payload", async () => {
    const reconcile = vi
      .fn<JobDeps["reconcileConnection"]>()
      .mockResolvedValue({ skipped: false, complete: true, subscriptions: 1, feeEvents: 3 });

    await createPaymentsReconcileConnectionHandler(
      silentLogger,
      reconcile,
    )([job(PAYMENTS_RECONCILE_CONNECTION, { connectionId })]);

    expect(reconcile).toHaveBeenCalledWith(connectionId);
  });
});
