import { EmailSendError, emailSendJob } from "@cohory/email";
import type { Job } from "pg-boss";

import { emailSendQueueOptions, queuedEmailSchema } from "@cohory/email";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const EMAIL_SEND = emailSendJob;

export type SendQueuedEmail = (payload: unknown) => Promise<void>;

const templateName = /^[a-z0-9-]{1,64}$/;

function templateOf(data: unknown): string {
  if (typeof data !== "object" || data === null || !("template" in data)) {
    return "unknown";
  }
  return typeof data.template === "string" && templateName.test(data.template)
    ? data.template
    : "unknown";
}

function reason(error: unknown): string {
  if (error instanceof EmailSendError) {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

export function createEmailSendHandler(logger: Logger, send: SendQueuedEmail) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const fields = { jobId: job.id, job: job.name, template: templateOf(job.data) };
      try {
        await send(job.data);
      } catch (error) {
        logger.warn({ ...fields, retry: job.retryCount, reason: reason(error) }, "email not sent");
        throw error;
      }
      logger.info(fields, "email sent");
    }
  };
}

export const emailSendJobDefinition: JobDefinition = {
  name: EMAIL_SEND,
  queueOptions: { ...emailSendQueueOptions },
  payloadSchema: queuedEmailSchema,
  handler: ({ logger, deps }) => createEmailSendHandler(logger, deps.sendQueuedEmail),
};
