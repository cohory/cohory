import { createLogger as createJsonLogger, type Logger } from "@cohory/infra/logger";

import type { WorkerEnv } from "./env";

export type { Logger };

export function createLogger(level: WorkerEnv["LOG_LEVEL"]): Logger {
  return createJsonLogger({ service: "worker", level });
}
