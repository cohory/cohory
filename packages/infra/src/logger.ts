import { z } from "zod";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogFields = Readonly<Record<string, unknown>>;

type LogMethod = (fieldsOrMessage: LogFields | string, message?: string) => void;

export interface Logger {
  readonly debug: LogMethod;
  readonly info: LogMethod;
  readonly warn: LogMethod;
  readonly error: LogMethod;
  readonly fatal: LogMethod;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  readonly service?: string;
  readonly level?: LogLevel | "silent";
  readonly now?: () => Date;
  readonly write?: (line: string, level: LogLevel) => void;
}

const rank: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
  silent: Number.POSITIVE_INFINITY,
};

const logLevelNames = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

/** `LOG_LEVEL` as every process reads it. `trace` is accepted for the worker and logs as debug. */
export const logLevelSchema = z
  .preprocess((value) => (value === "" ? undefined : value), z.enum(logLevelNames).default("info"))
  .transform((level): LogLevel | "silent" => (level === "trace" ? "debug" : level));

export function parseLogLevel(value: string | undefined): LogLevel | "silent" {
  const parsed = logLevelSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, or silent; got ${JSON.stringify(value)}.`,
    );
  }
  return parsed.data;
}

const sensitiveKey = /email|api_?key|hash|secret|password|token|authorization|cookie/i;
const reservedKeys = new Set(["level", "time", "service", "msg"]);
const maxDepth = 5;

function serializeError(error: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  const code: unknown = Reflect.get(error, "code");
  if (code !== undefined) {
    out.code = serialize(code, depth + 1);
  }
  if (error.cause !== undefined) {
    out.cause = depth >= maxDepth ? "[cause]" : serialize(error.cause, depth + 1);
  }
  out.stack = error.stack;
  return out;
}

function serialize(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return serializeError(value, depth);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return depth > maxDepth ? "[array]" : value.map((item) => serialize(item, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth > maxDepth) {
      return "[object]";
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sensitiveKey.test(key) ? "[redacted]" : serialize(item, depth + 1);
    }
    return out;
  }
  return typeof value === "bigint" ? value.toString() : value;
}

/** Caller fields keep their value under `field.<name>` when they collide with the line's own keys. */
function withoutReserved(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[reservedKeys.has(key) ? `field.${key}` : key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultWrite(line: string, level: LogLevel): void {
  if (rank[level] >= rank.warn) {
    console.error(line);
    return;
  }
  console.log(line);
}

export function createLogger(options: LoggerOptions = {}, bindings: LogFields = {}): Logger {
  const threshold = rank[options.level ?? parseLogLevel(process.env.LOG_LEVEL)];
  const now = options.now ?? (() => new Date());
  const write = options.write ?? defaultWrite;
  const base = options.service ? { service: options.service } : {};

  function method(level: LogLevel): LogMethod {
    return (fieldsOrMessage, message) => {
      if (rank[level] < threshold) {
        return;
      }
      const fields = typeof fieldsOrMessage === "string" ? {} : fieldsOrMessage;
      const msg = typeof fieldsOrMessage === "string" ? fieldsOrMessage : message;
      const entry = serialize({ ...bindings, ...fields }, 0);
      const extra = isRecord(entry) ? entry : {};
      write(
        JSON.stringify({
          ...withoutReserved(extra),
          level,
          time: now().toISOString(),
          ...base,
          msg,
        }),
        level,
      );
    };
  }

  return {
    debug: method("debug"),
    info: method("info"),
    warn: method("warn"),
    error: method("error"),
    fatal: method("fatal"),
    child: (more) => createLogger(options, { ...bindings, ...more }),
  };
}

/** The process wide logger for packages; an invalid LOG_LEVEL fails when the process starts. */
export const logger: Logger = createLogger();
