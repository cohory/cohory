import { postEventsJobPayloadSchema, postsMemberEmailJob } from "@cohory/events";
import { MemberEmailInterruptedError, type SendMemberEmail } from "@cohory/posts/member-email-job";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const POSTS_MEMBER_EMAIL = postsMemberEmailJob;

export function createPostsMemberEmailHandler(logger: Logger, sendMemberEmail: SendMemberEmail) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = postEventsJobPayloadSchema.parse(job.data);
      for (const event of events) {
        if (event.type !== "post.emailed") {
          continue;
        }
        const context = { jobId: job.id, job: job.name, postId: event.payload.postId };
        try {
          const result = await sendMemberEmail(event.payload, { signal: job.signal });
          if (result.stopped) {
            logger.warn({ ...context, ...result }, "member email stopped before every member");
          } else {
            logger.info({ ...context, ...result }, "post emailed to members");
          }
        } catch (error: unknown) {
          if (error instanceof MemberEmailInterruptedError) {
            logger.error(
              { ...context, sent: error.sent, failed: error.failed, err: error.cause },
              "member email broke off; it is not retried",
            );
          }
          throw error;
        }
      }
    }
  };
}

export const postsMemberEmailJobDefinition: JobDefinition = {
  name: POSTS_MEMBER_EMAIL,
  queueOptions: { retryLimit: 0 },
  payloadSchema: postEventsJobPayloadSchema,
  handler: ({ logger, deps }) => createPostsMemberEmailHandler(logger, deps.sendMemberEmail),
};
