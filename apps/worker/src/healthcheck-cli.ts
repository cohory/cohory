import { z } from "zod";

import { checkHeartbeat, defaultHeartbeatFile, defaultHeartbeatMaxAgeMs } from "./heartbeat";
import { runHealthcheck } from "./healthcheck";

const healthcheckEnvSchema = z.object({
  WORKER_HEARTBEAT_FILE: z
    .string()
    .optional()
    .transform((value) => (value ? value : defaultHeartbeatFile)),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().positive().default(defaultHeartbeatMaxAgeMs),
});

const env = healthcheckEnvSchema.parse(process.env);

process.exitCode = runHealthcheck(process.argv.slice(2), {
  check: () =>
    checkHeartbeat({ file: env.WORKER_HEARTBEAT_FILE, maxAgeMs: env.WORKER_HEARTBEAT_MAX_AGE_MS }),
  kill: (pid, signal) => process.kill(pid, signal),
  log: (message) => console.error(message),
});
