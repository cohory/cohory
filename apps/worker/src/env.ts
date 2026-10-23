import { parseAppUrl } from "@cohory/config/platform";
import { logLevelSchema } from "@cohory/infra/logger";
import { z } from "zod";

import { defaultHeartbeatFile } from "./heartbeat";

export const defaultFanoutPollSeconds = 2;

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const workerEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: logLevelSchema,
  WORKER_HEARTBEAT_FILE: z.preprocess(
    blankToUndefined,
    z.string().min(1).default(defaultHeartbeatFile),
  ),
  WORKER_FANOUT_POLL_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0.5).max(60).default(defaultFanoutPollSeconds),
  ),
});

export interface WorkerEnv {
  readonly DATABASE_URL: string;
  readonly LOG_LEVEL: z.infer<typeof workerEnvSchema>["LOG_LEVEL"];
  readonly appUrl: string;
  readonly heartbeatFile: string;
  readonly fanoutPollSeconds: number;
}

export function parseWorkerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerEnv {
  const parsed = workerEnvSchema.parse(env);
  return {
    DATABASE_URL: parsed.DATABASE_URL,
    LOG_LEVEL: parsed.LOG_LEVEL,
    appUrl: parseAppUrl(env),
    heartbeatFile: parsed.WORKER_HEARTBEAT_FILE,
    fanoutPollSeconds: parsed.WORKER_FANOUT_POLL_SECONDS,
  };
}
