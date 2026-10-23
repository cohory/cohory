import {
  memberBillingEndJob,
  memberBillingEndJobPayloadSchema,
  type MemberBillingEndJobPayload,
  type MemberRemovalResult,
} from "@cohory/payments";
import type { Job } from "pg-boss";

import { memberBillingEndQueueOptions } from "@cohory/payments";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_MEMBER_BILLING_END = memberBillingEndJob;

export type EndBillingForRemovedMember = (
  payload: MemberBillingEndJobPayload,
) => Promise<MemberRemovalResult>;

export function createPaymentsMemberBillingEndHandler(
  logger: Logger,
  end: EndBillingForRemovedMember,
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = memberBillingEndJobPayloadSchema.parse(job.data);
      const result = await end(payload);
      logger.info(
        {
          jobId: job.id,
          job: job.name,
          communityId: payload.communityId,
          kind: payload.kind,
          canceled: result.canceled,
        },
        "removed member's billing ended",
      );
    }
  };
}

export const paymentsMemberBillingEndJobDefinition: JobDefinition = {
  name: PAYMENTS_MEMBER_BILLING_END,
  queueOptions: { ...memberBillingEndQueueOptions },
  payloadSchema: memberBillingEndJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createPaymentsMemberBillingEndHandler(logger, deps.endBillingForRemovedMember),
};
