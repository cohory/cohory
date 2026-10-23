import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const SECRETS_REENCRYPT = "secrets.reencrypt";
export const secretsReencryptCron = "41 * * * *";

export interface SecretSweepResult {
  readonly scanned: number;
  readonly reencrypted: number;
  readonly unreadable: readonly string[];
}

export interface SecretsReencryptResult {
  readonly payments: SecretSweepResult | null;
  readonly webhooks: SecretSweepResult;
}

export type ReencryptSecrets = () => Promise<SecretsReencryptResult>;

function summary(result: SecretSweepResult | null) {
  return result
    ? {
        scanned: result.scanned,
        reencrypted: result.reencrypted,
        unreadable: result.unreadable.length,
      }
    : null;
}

export function createSecretsReencryptHandler(logger: Logger, run: ReencryptSecrets) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      const unreadable = [...(result.payments?.unreadable ?? []), ...result.webhooks.unreadable];
      logger.info(
        {
          jobId: job.id,
          job: job.name,
          payments: summary(result.payments),
          webhooks: summary(result.webhooks),
        },
        "stored secrets re-encrypted",
      );
      if (unreadable.length > 0) {
        logger.warn(
          { job: job.name, ids: unreadable },
          "stored secrets could not be decrypted with any configured key",
        );
      }
    }
  };
}

export const secretsReencryptJobDefinition: JobDefinition = {
  name: SECRETS_REENCRYPT,
  queueOptions: { policy: "stately" },
  cron: secretsReencryptCron,
  handler: ({ logger, deps }) => createSecretsReencryptHandler(logger, deps.reencryptSecrets),
};
