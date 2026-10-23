import type { Job } from "pg-boss";
import { z } from "zod";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const HEALTH_PING = "health.ping";

const healthPingPayloadSchema = z.object({
  sentAt: z.iso.datetime().optional(),
});

export type HealthPingPayload = z.infer<typeof healthPingPayloadSchema>;

export function createHealthPingHandler(logger: Logger) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = healthPingPayloadSchema.parse(job.data);
      logger.info({ jobId: job.id, job: job.name, sentAt: payload.sentAt }, "health ping received");
    }
  };
}

export const healthPingJobDefinition: JobDefinition = {
  name: HEALTH_PING,
  payloadSchema: healthPingPayloadSchema,
  handler: ({ logger }) => createHealthPingHandler(logger),
};
