import {
  accountPurgeCron,
  accountPurgeJob,
  getAccountPurge,
  type PurgeRunResult,
} from "@cohory/identity";
import { getPaymentsService } from "@cohory/payments";
import { avatarExtensions, avatarKey, getStorage } from "@cohory/storage";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const ACCOUNT_PURGE = accountPurgeJob;
export { accountPurgeCron };

export type PurgeDueAccounts = () => Promise<PurgeRunResult>;

export function defaultAccountPurge(logger: Logger): PurgeDueAccounts {
  const purge = getAccountPurge({
    deleteAvatar: async (userId) => {
      const storage = getStorage();
      await Promise.all(
        avatarExtensions.map((extension) => storage.delete(avatarKey(userId, extension))),
      );
    },
    releaseBilling: async (communityId, userId) => {
      await getPaymentsService().releaseBillingForUser(communityId, userId);
    },
    onBillingError: (error, userId) => {
      logger.warn(
        { err: error instanceof Error ? { name: error.name } : undefined, userId },
        "billing not released, erasure retries on the next run",
      );
    },
    onAvatarError: (error, userId) => {
      logger.warn(
        {
          err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
          userId,
        },
        "avatar not deleted for erased account",
      );
    },
  });
  return () => purge.purgeDueAccounts();
}

export function createAccountPurgeHandler(logger: Logger, run: PurgeDueAccounts) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      const log = result.blocked > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ jobId: job.id, job: job.name, ...result }, "accounts past the deletion date erased");
    }
  };
}

export const accountPurgeJobDefinition: JobDefinition = {
  name: ACCOUNT_PURGE,
  queueOptions: { policy: "stately" },
  cron: accountPurgeCron,
  handler: ({ logger, deps }) => createAccountPurgeHandler(logger, deps.purgeDueAccounts),
};
