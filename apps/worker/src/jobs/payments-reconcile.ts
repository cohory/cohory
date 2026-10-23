import {
  reconcileConnectionJob,
  reconcileConnectionJobPayloadSchema,
  reconcileSweepJob,
  type ConnectionReconcileResult,
  type ReconcileSweepResult,
} from "@cohory/payments";
import type { Job } from "pg-boss";

import { reconcileConnectionQueueOptions } from "@cohory/payments";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_RECONCILE = reconcileSweepJob;
export const PAYMENTS_RECONCILE_CONNECTION = reconcileConnectionJob;
export const paymentsReconcileCron = "45 3 * * *";

export type ScheduleConnectionReconciles = () => Promise<ReconcileSweepResult>;
export type ReconcileConnection = (connectionId: string) => Promise<ConnectionReconcileResult>;

export function createPaymentsReconcileHandler(
  logger: Logger,
  schedule: ScheduleConnectionReconciles,
) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await schedule();
      logger.info({ jobId: job.id, job: job.name, ...result }, "payment reconciliation scheduled");
    }
  };
}

export function createPaymentsReconcileConnectionHandler(
  logger: Logger,
  reconcile: ReconcileConnection,
) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const { connectionId } = reconcileConnectionJobPayloadSchema.parse(job.data);
      const result = await reconcile(connectionId);
      const log = result.subscriptions > 0 || !result.complete ? logger.warn : logger.info;
      log.call(
        logger,
        { jobId: job.id, job: job.name, connectionId, ...result },
        "payment connection reconciled",
      );
    }
  };
}

export const paymentsReconcileJobDefinition: JobDefinition = {
  name: PAYMENTS_RECONCILE,
  queueOptions: { policy: "stately" },
  cron: paymentsReconcileCron,
  handler: ({ logger, deps }) =>
    createPaymentsReconcileHandler(logger, deps.scheduleConnectionReconciles),
};

export const paymentsReconcileConnectionJobDefinition: JobDefinition = {
  name: PAYMENTS_RECONCILE_CONNECTION,
  queueOptions: { ...reconcileConnectionQueueOptions },
  payloadSchema: reconcileConnectionJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createPaymentsReconcileConnectionHandler(logger, deps.reconcileConnection),
};
