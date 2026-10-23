import { invalidAuthEnvNames } from "@cohory/auth";
import { pingDatabase } from "@cohory/db";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

export type ConfigCheck = "ok" | "missing";
export type DatabaseCheck = "ok" | "unreachable" | "skipped";

export interface ReadinessReport {
  readonly status: "ok" | "degraded";
  readonly checks: { readonly config: ConfigCheck; readonly database: DatabaseCheck };
}

export type Readiness = () => Promise<ReadinessReport>;

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

export function missingConfig(env: Readonly<Record<string, string | undefined>>): string[] {
  const missing = invalidAuthEnvNames(env);
  return databaseUrl.safeParse(env["DATABASE_URL"]).success
    ? missing
    : [...missing, "DATABASE_URL"];
}

export const defaultDatabaseProbeTimeoutMs = 3_000;

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("database probe timed out")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkReadiness(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly probeDatabase: () => Promise<void>;
  readonly timeoutMs?: number;
  readonly onFailure?: (detail: { missing: string[]; databaseError?: unknown }) => void;
}): Promise<ReadinessReport> {
  const missing = missingConfig(options.env);
  if (missing.length > 0) {
    options.onFailure?.({ missing });
    return { status: "degraded", checks: { config: "missing", database: "skipped" } };
  }
  try {
    await withTimeout(options.probeDatabase(), options.timeoutMs ?? defaultDatabaseProbeTimeoutMs);
  } catch (error: unknown) {
    options.onFailure?.({ missing, databaseError: error });
    return { status: "degraded", checks: { config: "ok", database: "unreachable" } };
  }
  return { status: "ok", checks: { config: "ok", database: "ok" } };
}

export const defaultReadiness: Readiness = () =>
  checkReadiness({
    env: process.env,
    probeDatabase: () => pingDatabase(),
    onFailure: ({ missing, databaseError }) => {
      logger.error(
        { missing, database: databaseError instanceof Error ? databaseError.message : undefined },
        "readiness check failed",
      );
    },
  });
