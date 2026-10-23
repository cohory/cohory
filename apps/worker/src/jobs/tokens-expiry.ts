import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const TOKENS_EXPIRY_NOTICE = "agents.token_expiry_notice";
export const tokensExpiryNoticeCron = "40 8 * * *";

export type NoticeExpiringTokens = () => Promise<{ noticed: number; failed: number }>;

export function createTokensExpiryNoticeHandler(logger: Logger, run: NoticeExpiringTokens) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "token expiry notices sent");
    }
  };
}

export const tokensExpiryNoticeJobDefinition: JobDefinition = {
  name: TOKENS_EXPIRY_NOTICE,
  queueOptions: { policy: "stately" },
  cron: tokensExpiryNoticeCron,
  handler: ({ logger, deps }) => createTokensExpiryNoticeHandler(logger, deps.noticeExpiringTokens),
};
