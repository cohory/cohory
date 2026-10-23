import { readFileSync, renameSync, writeFileSync } from "node:fs";

import { z } from "zod";

export const defaultHeartbeatFile = "/tmp/cohory-worker.heartbeat";
export const defaultHeartbeatIntervalMs = 15_000;
export const defaultHeartbeatMaxAgeMs = 90_000;

const heartbeatSchema = z.object({
  pid: z.number().int().positive(),
  at: z.iso.datetime(),
});

export type Heartbeat = z.infer<typeof heartbeatSchema>;

export interface HeartbeatOptions {
  readonly file: string;
  readonly intervalMs: number;
  readonly probe: () => Promise<void>;
  readonly onProbeError?: (error: unknown) => void;
  readonly pid?: number;
  readonly now?: () => Date;
}

export interface HeartbeatHandle {
  beat(): Promise<void>;
  stop(): void;
}

export function startHeartbeat(options: HeartbeatOptions): HeartbeatHandle {
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;

  async function beat(): Promise<void> {
    try {
      await options.probe();
    } catch (error: unknown) {
      options.onProbeError?.(error);
      return;
    }
    const temporary = `${options.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ pid, at: now().toISOString() }));
    renameSync(temporary, options.file);
  }

  const timer = setInterval(() => void beat(), options.intervalMs);
  timer.unref();
  return {
    beat,
    stop: () => clearInterval(timer),
  };
}

export function readHeartbeat(file: string): Heartbeat | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = heartbeatSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type HeartbeatCheck =
  | { readonly healthy: true; readonly pid: number }
  | { readonly healthy: false; readonly pid: number | null; readonly reason: "missing" | "stale" };

export function checkHeartbeat(options: {
  readonly file: string;
  readonly maxAgeMs: number;
  readonly now?: () => Date;
}): HeartbeatCheck {
  const heartbeat = readHeartbeat(options.file);
  if (!heartbeat) {
    return { healthy: false, pid: null, reason: "missing" };
  }
  const now = options.now ?? (() => new Date());
  const age = now().getTime() - new Date(heartbeat.at).getTime();
  if (age > options.maxAgeMs) {
    return { healthy: false, pid: heartbeat.pid, reason: "stale" };
  }
  return { healthy: true, pid: heartbeat.pid };
}
