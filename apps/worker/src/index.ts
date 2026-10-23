import { parsePoolEnv, setPoolRole } from "@cohory/db";
import { emailConfigProblem, ensureEmailSendQueue } from "@cohory/email";
import { PgBoss } from "pg-boss";

import { parseWorkerEnv } from "./env";
import { defaultHeartbeatIntervalMs, type HeartbeatHandle, startHeartbeat } from "./heartbeat";
import { createLogger } from "./logger";
import { defaultJobDeps } from "./services";
import { registerJobs } from "./worker";

setPoolRole("worker");
const env = parseWorkerEnv();
const pool = parsePoolEnv(process.env, "worker");
const logger = createLogger(env.LOG_LEVEL);
const emailProblem = emailConfigProblem();
if (emailProblem) {
  logger.error(emailProblem);
}
const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  max: pool.max,
  connectionTimeoutMillis: pool.connectionTimeoutMs,
});

boss.on("error", (error) => {
  logger.error({ err: error }, "pg-boss error");
});

let stopping = false;
let heartbeat: HeartbeatHandle | null = null;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  heartbeat?.stop();
  logger.info({ signal }, "worker stopping");
  await boss.stop({ graceful: true });
  logger.info("worker stopped");
  process.exit(0);
}

process.once("SIGTERM", (signal) => void shutdown(signal));
process.once("SIGINT", (signal) => void shutdown(signal));

try {
  await boss.start();
  await ensureEmailSendQueue(boss);
  await registerJobs(boss, logger, defaultJobDeps(env.appUrl, logger), {
    fanoutPollSeconds: env.fanoutPollSeconds,
  });
  heartbeat = startHeartbeat({
    file: env.heartbeatFile,
    intervalMs: defaultHeartbeatIntervalMs,
    probe: async () => {
      await boss.getDb().executeSql("select 1");
    },
    onProbeError: (error) => logger.warn({ err: error }, "worker heartbeat probe failed"),
  });
  await heartbeat.beat();
  logger.info("worker started");
} catch (error: unknown) {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
}
