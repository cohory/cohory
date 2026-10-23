import type { HeartbeatCheck } from "./heartbeat";

export interface HealthcheckDeps {
  readonly check: () => HeartbeatCheck;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly log: (message: string) => void;
}

export function runHealthcheck(args: readonly string[], deps: HealthcheckDeps): number {
  const result = deps.check();
  if (result.healthy) {
    return 0;
  }
  deps.log(`worker heartbeat ${result.reason}`);
  if (args.includes("--restart") && result.pid !== null && result.pid !== 1) {
    try {
      deps.kill(result.pid, "SIGKILL");
      deps.log(`stopped worker process ${String(result.pid)}`);
    } catch {
      deps.log(`worker process ${String(result.pid)} is already gone`);
    }
  }
  return 1;
}
